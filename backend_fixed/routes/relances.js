'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

// ─── GET /api/quotes/:id/relances ─────────────────────────────────────────────
// Retourne l'état des relances pour un devis
router.get('/:id/relances', requireAuth, async (req, res) => {
  try {
    // Plan Pro ou Équipe requis
    if (req.user.plan !== 'team' && req.user.plan !== 'pro') {
      return res.status(403).json({ error: 'Les relances automatiques sont réservées aux plans Pro ✦ et Équipe ◆.', upgrade: true });
    }

    const quote = await db.get('SELECT id FROM quotes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

    const relance = await db.get('SELECT * FROM relances WHERE quote_id = $1 AND user_id = $2', [req.params.id, req.user.id]);

    if (!relance) {
      return res.json({ active: false, sent_count: 0, max_relances: 5, history: [] });
    }

    const logs = await db.all(
      'SELECT * FROM relance_logs WHERE relance_id = $1 ORDER BY sent_at DESC LIMIT 20',
      [relance.id]
    );

    const history = logs.map(l => ({
      date: l.sent_at,
      email: l.to_email,
      status: l.status,
      attempt: l.attempt,
    }));

    res.json({
      active: relance.active,
      sent_count: relance.sent_count,
      max_relances: relance.max_count,
      interval_hours: relance.interval_hours || 24,
      next_send: relance.next_send_at,
      history,
    });
  } catch (err) {
    console.error('GET relances:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── POST /api/quotes/:id/relances ────────────────────────────────────────────
// Active / désactive ou met à jour les relances pour un devis
router.post('/:id/relances', requireAuth, async (req, res) => {
  try {
    if (req.user.plan !== 'team' && req.user.plan !== 'pro') {
      return res.status(403).json({ error: 'Les relances automatiques sont réservées aux plans Pro ✦ et Équipe ◆.', upgrade: true });
    }

    const quote = await db.get('SELECT * FROM quotes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

    // Pas de relance sur un devis déjà accepté/refusé
    if (quote.status === 'accepted' || quote.status === 'refused') {
      return res.status(400).json({ error: `Impossible d'activer les relances : le devis est déjà ${quote.status === 'accepted' ? 'accepté' : 'refusé'}.` });
    }

    const { active, email, interval_hours = 24, max_count = 5 } = req.body;
    const clientEmail = email || quote.client_email;
    if (!clientEmail) return res.status(400).json({ error: 'Email client requis pour activer les relances.' });

    const existing = await db.get('SELECT * FROM relances WHERE quote_id = $1 AND user_id = $2', [req.params.id, req.user.id]);

    const nextSendAt = active ? new Date(Date.now() + interval_hours * 3600 * 1000).toISOString() : null;

    if (existing) {
      await db.run(
        `UPDATE relances SET active=$1, client_email=$2, interval_hours=$3, max_count=$4, next_send_at=$5, updated_at=NOW()
         WHERE id=$6`,
        [active, clientEmail, interval_hours, max_count, nextSendAt, existing.id]
      );
    } else {
      await db.run(
        `INSERT INTO relances (id, quote_id, user_id, client_email, active, interval_hours, max_count, sent_count, next_send_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8)`,
        [uuidv4(), req.params.id, req.user.id, clientEmail, active, interval_hours, max_count, nextSendAt]
      );
    }

    // Mettre à jour l'email client sur le devis si fourni
    if (email) {
      await db.run('UPDATE quotes SET client_email=$1 WHERE id=$2', [email, req.params.id]);
    }

    res.json({
      active,
      next_send: nextSendAt,
      message: active ? `Relances activées — prochain envoi à ${new Date(nextSendAt).toLocaleString('fr-FR')}` : 'Relances désactivées.',
    });
  } catch (err) {
    console.error('POST relances:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;

// ─── POST /api/quotes/:id/relances/send-now ───────────────────────────────────
// Envoie une relance immédiatement
router.post('/:id/relances/send-now', requireAuth, async (req, res) => {
  try {
    if (req.user.plan !== 'team' && req.user.plan !== 'pro') {
      return res.status(403).json({ error: 'Les relances sont réservées aux plans Pro et Équipe.' });
    }

    const quote = await db.get('SELECT * FROM quotes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

    const { email } = req.body;
    const clientEmail = email || quote.client_email;
    if (!clientEmail) return res.status(400).json({ error: 'Email client requis.' });

    const { sendRelanceEmail } = require('../services/email');
    const frontendUrl = process.env.FRONTEND_URL || 'https://quotly-frontend.vercel.app';
    const signatureUrl = `${frontendUrl}/sign/${quote.signature_token}`;

    let totalTTC = null;
    try {
      const items = typeof quote.items === 'string' ? JSON.parse(quote.items) : quote.items;
      const ht = items.reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0), 0);
      totalTTC = ht * (1 + (quote.tva_rate || 20) / 100);
    } catch (_) {}

    await sendRelanceEmail({
      to: clientEmail,
      senderName: req.user.name,
      quoteNumber: quote.number,
      quoteId: quote.id,
      signatureToken: quote.signature_token,
      attemptNumber: 1,
      totalAmount: totalTTC,
    });

    if (email) await db.run('UPDATE quotes SET client_email=$1 WHERE id=$2', [email, quote.id]);

    res.json({ message: `Relance envoyée à ${clientEmail}.` });
  } catch (err) {
    console.error('send-now relance:', err);
    res.status(500).json({ error: 'Erreur envoi relance : ' + err.message });
  }
});
