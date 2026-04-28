'use strict';
/**
 * ═══════════════════════════════════════════════════════
 *  SCHEDULER DE RELANCES AUTOMATIQUES — Plan Équipe ◆
 *  Tournant en arrière-plan toutes les 5 minutes
 *  → Envoie les relances aux clients dont le devis
 *    est en attente depuis 24h (configurable)
 * ═══════════════════════════════════════════════════════
 */
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/schema');
const { sendRelanceEmail } = require('./email');

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // vérification toutes les 5 min

async function processRelances() {
  try {
    // Récupère toutes les relances actives dont l'heure d'envoi est passée
    const dueRelances = await db.all(`
      SELECT
        r.*,
        q.number     AS quote_number,
        q.status     AS quote_status,
        q.signature_token,
        q.items      AS quote_items,
        q.tva_rate,
        u.name       AS sender_name,
        u.plan       AS user_plan
      FROM relances r
      JOIN quotes q ON q.id = r.quote_id
      JOIN users  u ON u.id = r.user_id
      WHERE r.active = TRUE
        AND r.next_send_at IS NOT NULL
        AND r.next_send_at <= NOW()
        AND (u.plan = 'team' OR u.plan = 'pro')
    `);

    if (!dueRelances.length) return;

    console.log(`[Relances] ${dueRelances.length} relance(s) à traiter…`);

    for (const relance of dueRelances) {
      try {
        // Arrêt auto si le devis est déjà accepté ou refusé
        if (relance.quote_status === 'accepted' || relance.quote_status === 'refused') {
          await db.run('UPDATE relances SET active=FALSE, next_send_at=NULL WHERE id=$1', [relance.id]);
          console.log(`[Relances] Devis ${relance.quote_number} déjà ${relance.quote_status} → relances stoppées.`);
          continue;
        }

        // Limite de relances atteinte
        if (relance.sent_count >= relance.max_count) {
          await db.run('UPDATE relances SET active=FALSE, next_send_at=NULL WHERE id=$1', [relance.id]);
          console.log(`[Relances] Devis ${relance.quote_number} : limite max atteinte (${relance.max_count}) → relances stoppées.`);
          continue;
        }

        // Calcul du montant TTC pour l'email
        let totalTTC = null;
        try {
          const items = typeof relance.quote_items === 'string' ? JSON.parse(relance.quote_items) : relance.quote_items;
          const ht = items.reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0), 0);
          totalTTC = ht * (1 + (relance.tva_rate || 20) / 100);
        } catch (_) {}

        const attemptNumber = relance.sent_count + 1;

        // Envoi de l'email de relance
        await sendRelanceEmail({
          to: relance.client_email,
          senderName: relance.sender_name,
          quoteNumber: relance.quote_number,
          quoteId: relance.quote_id,
          signatureToken: relance.signature_token,
          attemptNumber,
          totalAmount: totalTTC,
        });

        // Log de la relance
        await db.run(
          `INSERT INTO relance_logs (id, relance_id, quote_id, to_email, attempt, status, sent_at)
           VALUES ($1,$2,$3,$4,$5,'sent',NOW())`,
          [uuidv4(), relance.id, relance.quote_id, relance.client_email, attemptNumber]
        );

        // Calcul du prochain envoi
        const newSentCount = attemptNumber;
        const isFinished = newSentCount >= relance.max_count;
        const nextSendAt = isFinished
          ? null
          : new Date(Date.now() + relance.interval_hours * 3600 * 1000).toISOString();

        await db.run(
          `UPDATE relances
           SET sent_count=$1, next_send_at=$2, active=$3, updated_at=NOW()
           WHERE id=$4`,
          [newSentCount, nextSendAt, !isFinished, relance.id]
        );

        console.log(`[Relances] ✉ Relance #${attemptNumber} envoyée → ${relance.client_email} pour devis ${relance.quote_number}${isFinished ? ' [FIN]' : ` (prochain: ${nextSendAt})`}`);

      } catch (err) {
        console.error(`[Relances] Erreur pour relance ${relance.id}:`, err.message);

        // Log d'échec
        try {
          await db.run(
            `INSERT INTO relance_logs (id, relance_id, quote_id, to_email, attempt, status, sent_at)
             VALUES ($1,$2,$3,$4,$5,'failed',NOW())`,
            [uuidv4(), relance.id, relance.quote_id, relance.client_email, relance.sent_count + 1]
          );
        } catch (_) {}
      }
    }
  } catch (err) {
    console.error('[Relances] Erreur scheduler:', err.message);
  }
}

function startRelanceScheduler() {
  console.log(`[Relances] Scheduler démarré — vérification toutes les ${CHECK_INTERVAL_MS / 60000} min`);

  // Premier check au démarrage (léger délai pour laisser la DB s'initialiser)
  setTimeout(processRelances, 10_000);

  // Puis toutes les 5 minutes
  setInterval(processRelances, CHECK_INTERVAL_MS);
}

module.exports = { startRelanceScheduler, processRelances };
