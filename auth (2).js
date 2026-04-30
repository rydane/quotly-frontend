'use strict';
/**
 * ═══════════════════════════════════════════════════════
 *  ROUTES RELANCES
 *  GET  /api/quotes/:id/relances       → liste toutes les relances du devis
 *  POST /api/quotes/:id/relances       → ajoute UNE NOUVELLE relance
 *  PUT  /api/quotes/:id/relances/:rid  → modifie une relance existante
 *  DELETE /api/quotes/:id/relances/:rid→ supprime une relance
 *  POST /api/relances/cron             → endpoint cron (CRON_SECRET)
 * ═══════════════════════════════════════════════════════
 */
const router = require('express').Router();
const { v4: uuidv4 }       = require('uuid');
const { db }               = require('../db/schema');
const { requireAuth }      = require('../middleware/auth');
const { processRelances }  = require('../services/relanceScheduler');
const { sendRelanceEmail } = require('../services/email');

// ─── Vérification plan Pro/Équipe ─────────────────────────────────────────────
function requirePro(req, res, next) {
  if (req.user.plan !== 'team' && req.user.plan !== 'pro') {
    return res.status(403).json({
      error  : 'Les relances automatiques sont réservées aux plans Pro ✦ et Équipe ◆.',
      upgrade: true,
    });
  }
  next();
}

// ─── GET /api/quotes/:id/relances ─────────────────────────────────────────────
// Retourne TOUTES les relances du devis (peut en avoir plusieurs simultanément)
router.get('/:id/relances', requireAuth, requirePro, async (req, res) => {
  try {
    const quote = await db.get(
      'SELECT id FROM quotes WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

    // Toutes les relances pour ce devis
    const relances = await db.all(
      `SELECT r.*,
              (SELECT COUNT(*) FROM relance_logs rl WHERE rl.relance_id = r.id AND rl.status = 'sent') AS confirmed_sent
       FROM relances r
       WHERE r.quote_id = $1 AND r.user_id = $2
       ORDER BY r.created_at DESC`,
      [req.params.id, req.user.id]
    );

    // Historique complet des envois
    const logs = relances.length
      ? await db.all(
          `SELECT rl.*, r.client_email AS relance_email
           FROM relance_logs rl
           JOIN relances r ON r.id = rl.relance_id
           WHERE r.quote_id = $1
           ORDER BY rl.sent_at DESC
           LIMIT 50`,
          [req.params.id]
        )
      : [];

    res.json({
      relances: relances.map(r => ({
        id            : r.id,
        active        : r.active,
        client_email  : r.client_email,
        interval_hours: r.interval_hours,
        max_count     : r.max_count,
        sent_count    : r.sent_count,
        next_send_at  : r.next_send_at,
        created_at    : r.created_at,
        updated_at    : r.updated_at,
      })),
      history: logs.map(l => ({
        id        : l.id,
        relance_id: l.relance_id,
        date      : l.sent_at,
        email     : l.to_email,
        status    : l.status,
        attempt   : l.attempt,
        error     : l.error_message || null,
      })),
    });
  } catch (err) {
    console.error('GET relances:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── POST /api/quotes/:id/relances ────────────────────────────────────────────
// Crée UNE NOUVELLE relance (plusieurs relances simultanées autorisées)
router.post('/:id/relances', requireAuth, requirePro, async (req, res) => {
  try {
    const quote = await db.get(
      'SELECT * FROM quotes WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

    if (quote.status === 'accepted' || quote.status === 'refused') {
      return res.status(400).json({
        error: `Impossible d'activer les relances : le devis est déjà ${quote.status === 'accepted' ? 'accepté' : 'refusé'}.`,
      });
    }

    const {
      email,
      interval_hours = 24,
      max_count      = 5,
      active         = true,
    } = req.body;

    const clientEmail = email || quote.client_email;
    if (!clientEmail || !clientEmail.includes('@')) {
      return res.status(400).json({ error: 'Email client valide requis pour activer les relances.' });
    }

    // Validation des paramètres
    const intervalH = Math.max(1, Math.min(720, parseInt(interval_hours) || 24));
    const maxCount  = Math.max(1, Math.min(20,  parseInt(max_count)      || 5));

    // Calcul du premier envoi : maintenant + interval_hours
    const nextSendAt = active
      ? new Date(Date.now() + intervalH * 3600 * 1000).toISOString()
      : null;

    const relanceId = uuidv4();

    // INSERT : on crée toujours une NOUVELLE relance (pas d'upsert)
    await db.run(
      `INSERT INTO relances
         (id, quote_id, user_id, client_email, active, interval_hours, max_count, sent_count, next_send_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8)`,
      [relanceId, req.params.id, req.user.id, clientEmail, active, intervalH, maxCount, nextSendAt]
    );

    // Met à jour l'email client sur le devis si fourni
    if (email) {
      await db.run('UPDATE quotes SET client_email=$1 WHERE id=$2', [email, req.params.id]);
    }

    const relance = await db.get('SELECT * FROM relances WHERE id=$1', [relanceId]);

    res.status(201).json({
      relance: {
        id            : relance.id,
        active        : relance.active,
        client_email  : relance.client_email,
        interval_hours: relance.interval_hours,
        max_count     : relance.max_count,
        sent_count    : relance.sent_count,
        next_send_at  : relance.next_send_at,
        created_at    : relance.created_at,
      },
      message: active
        ? `✦ Relance créée — 1er envoi le ${new Date(nextSendAt).toLocaleString('fr-FR')}`
        : 'Relance créée (inactive).',
    });
  } catch (err) {
    console.error('POST relances:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── PUT /api/quotes/:id/relances/:rid ───────────────────────────────────────
// Modifie une relance existante (active/inactive, paramètres)
router.put('/:id/relances/:rid', requireAuth, requirePro, async (req, res) => {
  try {
    const relance = await db.get(
      'SELECT * FROM relances WHERE id=$1 AND user_id=$2 AND quote_id=$3',
      [req.params.rid, req.user.id, req.params.id]
    );
    if (!relance) return res.status(404).json({ error: 'Relance introuvable.' });

    const {
      active         = relance.active,
      email          = relance.client_email,
      interval_hours = relance.interval_hours,
      max_count      = relance.max_count,
    } = req.body;

    const intervalH = Math.max(1, Math.min(720, parseInt(interval_hours) || 24));
    const maxCount  = Math.max(1, Math.min(20,  parseInt(max_count)      || 5));

    // Si on réactive une relance terminée, recalculer next_send_at
    const nextSendAt = active && (!relance.active || !relance.next_send_at)
      ? new Date(Date.now() + intervalH * 3600 * 1000).toISOString()
      : active
        ? relance.next_send_at
        : null;

    await db.run(
      `UPDATE relances
       SET active=$1, client_email=$2, interval_hours=$3, max_count=$4, next_send_at=$5, updated_at=NOW()
       WHERE id=$6`,
      [active, email, intervalH, maxCount, nextSendAt, req.params.rid]
    );

    res.json({
      message: active ? 'Relance réactivée.' : 'Relance désactivée.',
      next_send_at: nextSendAt,
    });
  } catch (err) {
    console.error('PUT relances:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── DELETE /api/quotes/:id/relances/:rid ────────────────────────────────────
router.delete('/:id/relances/:rid', requireAuth, requirePro, async (req, res) => {
  try {
    const relance = await db.get(
      'SELECT id FROM relances WHERE id=$1 AND user_id=$2 AND quote_id=$3',
      [req.params.rid, req.user.id, req.params.id]
    );
    if (!relance) return res.status(404).json({ error: 'Relance introuvable.' });

    await db.run('DELETE FROM relances WHERE id=$1', [req.params.rid]);
    res.json({ message: 'Relance supprimée.' });
  } catch (err) {
    console.error('DELETE relances:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── POST /api/quotes/:id/relances/send-now ──────────────────────────────────
// Envoi immédiat d'une relance manuelle
router.post('/:id/relances/send-now', requireAuth, requirePro, async (req, res) => {
  try {
    const quote = await db.get(
      `SELECT q.*, u.name AS sender_name
       FROM quotes q JOIN users u ON u.id = q.user_id
       WHERE q.id = $1 AND q.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

    const clientEmail = req.body.email || quote.client_email;
    if (!clientEmail) return res.status(400).json({ error: 'Email client requis.' });

    // Compter les relances déjà envoyées pour ce devis
    const countRes = await db.get(
      `SELECT COUNT(*) AS cnt FROM relance_logs rl
       JOIN relances r ON r.id = rl.relance_id
       WHERE r.quote_id = $1 AND rl.status = 'sent'`,
      [req.params.id]
    );
    const attemptNumber = parseInt(countRes.cnt || 0) + 1;

    let totalTTC = null;
    try {
      const items = typeof quote.items === 'string' ? JSON.parse(quote.items) : quote.items;
      const ht = items.reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0), 0);
      totalTTC = ht * (1 + (quote.tva_rate || 20) / 100);
    } catch (_) {}

    await sendRelanceEmail({
      to            : clientEmail,
      senderName    : quote.sender_name,
      quoteNumber   : quote.number,
      quoteId       : quote.id,
      signatureToken: quote.signature_token,
      attemptNumber,
      totalAmount   : totalTTC,
    });

    // Log dans relance_logs (sous relance "manuelle" si elle existe)
    const anyRelance = await db.get(
      'SELECT id FROM relances WHERE quote_id=$1 AND user_id=$2 LIMIT 1',
      [req.params.id, req.user.id]
    );

    if (anyRelance) {
      await db.run(
        `INSERT INTO relance_logs (id, relance_id, quote_id, to_email, attempt, status, sent_at)
         VALUES ($1,$2,$3,$4,$5,'sent',NOW())`,
        [uuidv4(), anyRelance.id, req.params.id, clientEmail, attemptNumber]
      );
    }

    res.json({
      message: `✉ Relance manuelle envoyée à ${clientEmail}`,
      sent_at: new Date().toISOString(),
      attempt: attemptNumber,
    });
  } catch (err) {
    console.error('send-now:', err);
    res.status(500).json({ error: `Échec de l'envoi : ${err.message}` });
  }
});

// ─── CRON ROUTER séparé (monté sous /api dans server.js) ──────────────────────
// Nécessaire pour que GET /api/relances/cron ne soit pas intercepté par le
// router /api/quotes qui capture /api/quotes/relances/...
const cronRouter = require('express').Router();

// GET /api/relances/cron
// Endpoint pour les cron jobs externes (Vercel Cron, cron-job.org, GitHub Actions…)
// Protégé par CRON_SECRET
cronRouter.get('/relances/cron', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers['x-cron-secret'] || req.query.secret;
    if (provided !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  console.log(`[Cron] Déclenchement à ${new Date().toISOString()}`);
  try {
    const result = await processRelances();
    res.json({
      ok       : true,
      timestamp: new Date().toISOString(),
      processed: result.processed,
    });
  } catch (err) {
    console.error('[Cron] Erreur:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, cronRouter };
