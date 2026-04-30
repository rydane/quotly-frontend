'use strict';
/**
 * ═══════════════════════════════════════════════════════
 *  SCHEDULER DE RELANCES AUTOMATIQUES
 *
 *  Deux modes de fonctionnement :
 *
 *  1) SERVEUR PERSISTANT (Render, Railway, VPS…)
 *     → setInterval toutes les 2 minutes (ultra-fiable)
 *     → startRelanceScheduler() à appeler au démarrage
 *
 *  2) VERCEL SERVERLESS / CRON EXTERNE
 *     → Endpoint GET /api/relances/cron (protégé par CRON_SECRET)
 *     → À appeler depuis Vercel Cron Jobs (vercel.json) ou
 *       un service externe (cron-job.org, GitHub Actions, etc.)
 *     → processRelances() est exportée pour être appelée
 *       directement depuis la route cron
 *
 *  Dans les deux cas, l'état est 100% en base PostgreSQL :
 *  les relances survivent aux redémarrages serveur.
 * ═══════════════════════════════════════════════════════
 */
const { v4: uuidv4 }        = require('uuid');
const { db }                = require('../db/schema');
const { sendRelanceEmail }  = require('./email');

// Vérification toutes les 2 minutes (au lieu de 5) pour réduire le délai max
const CHECK_INTERVAL_MS = 2 * 60 * 1000;

// ─── Traitement des relances dues ─────────────────────────────────────────────
async function processRelances() {
  let processed = 0;
  try {
    // Récupère toutes les relances actives dont l'heure d'envoi est dépassée
    // next_send_at <= NOW() garantit l'exactitude temporelle côté DB
    const dueRelances = await db.all(`
      SELECT
        r.*,
        q.number          AS quote_number,
        q.status          AS quote_status,
        q.signature_token,
        q.items           AS quote_items,
        q.tva_rate,
        u.name            AS sender_name,
        u.plan            AS user_plan
      FROM relances r
      JOIN quotes q ON q.id = r.quote_id
      JOIN users  u ON u.id = r.user_id
      WHERE r.active = TRUE
        AND r.next_send_at IS NOT NULL
        AND r.next_send_at <= NOW()
        AND (u.plan = 'team' OR u.plan = 'pro')
      ORDER BY r.next_send_at ASC
    `);

    if (!dueRelances.length) {
      return { processed: 0 };
    }

    console.log(`[Relances] ${dueRelances.length} relance(s) à traiter…`);

    for (const relance of dueRelances) {
      try {
        // ── Arrêt auto si devis déjà signé ou refusé ──────────────────────
        if (relance.quote_status === 'accepted' || relance.quote_status === 'refused') {
          await db.run(
            'UPDATE relances SET active=FALSE, next_send_at=NULL, updated_at=NOW() WHERE id=$1',
            [relance.id]
          );
          console.log(`[Relances] Devis ${relance.quote_number} déjà ${relance.quote_status} → relances stoppées.`);
          continue;
        }

        // ── Limite atteinte ────────────────────────────────────────────────
        if (relance.sent_count >= relance.max_count) {
          await db.run(
            'UPDATE relances SET active=FALSE, next_send_at=NULL, updated_at=NOW() WHERE id=$1',
            [relance.id]
          );
          console.log(`[Relances] Devis ${relance.quote_number} : limite atteinte (${relance.max_count}) → arrêt.`);
          continue;
        }

        // ── Calcul montant TTC ─────────────────────────────────────────────
        let totalTTC = null;
        try {
          const items = typeof relance.quote_items === 'string'
            ? JSON.parse(relance.quote_items)
            : relance.quote_items;
          const ht = items.reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0), 0);
          totalTTC = ht * (1 + (relance.tva_rate || 20) / 100);
        } catch (_) {}

        const attemptNumber = relance.sent_count + 1;

        // ── Envoi email via Brevo ──────────────────────────────────────────
        await sendRelanceEmail({
          to            : relance.client_email,
          senderName    : relance.sender_name,
          quoteNumber   : relance.quote_number,
          quoteId       : relance.quote_id,
          signatureToken: relance.signature_token,
          attemptNumber,
          totalAmount   : totalTTC,
        });

        // ── Log de succès ──────────────────────────────────────────────────
        await db.run(
          `INSERT INTO relance_logs (id, relance_id, quote_id, to_email, attempt, status, sent_at)
           VALUES ($1,$2,$3,$4,$5,'sent',NOW())`,
          [uuidv4(), relance.id, relance.quote_id, relance.client_email, attemptNumber]
        );

        // ── Mise à jour : prochain envoi ou fin ───────────────────────────
        const newSentCount = attemptNumber;
        const isFinished   = newSentCount >= relance.max_count;

        // Calcul du prochain next_send_at DEPUIS MAINTENANT + interval_hours
        // (pas depuis next_send_at pour éviter la dérive en cas de retard scheduler)
        const nextSendAt = isFinished
          ? null
          : new Date(Date.now() + relance.interval_hours * 3600 * 1000).toISOString();

        await db.run(
          `UPDATE relances
           SET sent_count=$1, next_send_at=$2, active=$3, updated_at=NOW()
           WHERE id=$4`,
          [newSentCount, nextSendAt, !isFinished, relance.id]
        );

        console.log(
          `[Relances] ✉ #${attemptNumber} envoyée → ${relance.client_email}` +
          ` | Devis ${relance.quote_number}` +
          (isFinished ? ' [FIN]' : ` | prochain: ${nextSendAt}`)
        );

        processed++;

      } catch (err) {
        console.error(`[Relances] ❌ Erreur relance ${relance.id}:`, err.message);

        // Log d'échec en DB pour visibilité dans l'UI
        try {
          await db.run(
            `INSERT INTO relance_logs (id, relance_id, quote_id, to_email, attempt, status, error_message, sent_at)
             VALUES ($1,$2,$3,$4,$5,'failed',$6,NOW())`,
            [
              uuidv4(),
              relance.id,
              relance.quote_id,
              relance.client_email,
              relance.sent_count + 1,
              err.message.substring(0, 500),
            ]
          );
        } catch (logErr) {
          console.error('[Relances] Impossible de logger l\'échec:', logErr.message);
        }
      }
    }

  } catch (err) {
    console.error('[Relances] Erreur scheduler globale:', err.message);
  }

  return { processed };
}

// ─── Démarrage du scheduler (serveur persistant uniquement) ───────────────────
function startRelanceScheduler() {
  console.log(`[Relances] Scheduler démarré — vérification toutes les ${CHECK_INTERVAL_MS / 60000} min`);

  // Premier check après 15s (laisser la DB s'initialiser)
  setTimeout(processRelances, 15_000);

  // Puis toutes les CHECK_INTERVAL_MS
  const interval = setInterval(processRelances, CHECK_INTERVAL_MS);

  // Permet d'annuler proprement (tests, graceful shutdown)
  return interval;
}

module.exports = { startRelanceScheduler, processRelances };
