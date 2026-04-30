'use strict';
const router = require('express').Router();
const { db } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { createNotification } = require('./notifications');

const QUOTA_FREE_SIGNATURES = 5;

// ─── GET /api/sign/:token — page publique de signature ────────────────────────
router.get('/:token', async (req, res) => {
  try {
    const quote = await db.get('SELECT * FROM quotes WHERE signature_token = $1', [req.params.token]);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable ou lien expiré.' });
    res.json({ quote });
  } catch(err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

// ─── POST /api/sign/:token — signer le devis ─────────────────────────────────
router.post('/:token', async (req, res) => {
  try {
    const { signature_data, signer_name } = req.body;
    if (!signature_data) return res.status(400).json({ error: 'Signature manquante.' });

    const quote = await db.get('SELECT * FROM quotes WHERE signature_token = $1', [req.params.token]);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });
    if (quote.signed_at) return res.status(409).json({ error: 'Ce devis est déjà signé.' });

    // ✅ Vérifier la limite de signatures du propriétaire du devis
    const owner = await db.get('SELECT id, plan, signatures_count FROM users WHERE id = $1', [quote.user_id]);
    if (owner && owner.plan === 'starter') {
      const sigCount = owner.signatures_count || 0;
      if (sigCount >= QUOTA_FREE_SIGNATURES) {
        return res.status(403).json({
          error: `Le propriétaire de ce devis a atteint la limite de ${QUOTA_FREE_SIGNATURES} signatures électroniques sur le plan gratuit.`,
          upgrade: true
        });
      }
    }

    const now = new Date().toISOString();
    await db.run(
      "UPDATE quotes SET signature_data = $1, signed_at = $2, status = 'accepted', signer_name = $3 WHERE signature_token = $4",
      [signature_data, now, signer_name || '', req.params.token]
    );

    // Arrêt automatique des relances si le devis est accepté
    await db.run(
      "UPDATE relances SET active=FALSE, next_send_at=NULL WHERE quote_id=$1",
      [quote.id]
    );

    // Incrémenter le compteur de signatures du propriétaire
    if (owner) {
      await db.run('UPDATE users SET signatures_count = COALESCE(signatures_count, 0) + 1 WHERE id = $1', [owner.id]);
    }

    // 🔔 Créer une notification pour l'entreprise (propriétaire du devis)
    await createNotification({
      user_id: quote.user_id,
      type: 'quote_signed',
      title: 'Devis signé ✍️',
      message: `${signer_name || quote.client_name} a signé le devis ${quote.number}.`,
      data: {
        quote_id: quote.id,
        quote_number: quote.number,
        client_name: quote.client_name,
        signer_name: signer_name || quote.client_name,
        signed_at: now,
      },
    });

    res.json({ message: 'Devis signé avec succès.', quote_number: quote.number });
  } catch(err) { console.error('sign:', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

// ─── GET /api/sign/status/:quoteId — statut signature (authentifié) ───────────
router.get('/status/:quoteId', requireAuth, async (req, res) => {
  try {
    const quote = await db.get(
      'SELECT id, number, status, signed_at, signer_name, signature_token FROM quotes WHERE id = $1 AND user_id = $2',
      [req.params.quoteId, req.user.id]
    );
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });
    res.json({ quote });
  } catch(err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});


// ─── POST /api/sign/:token/refuse — refuser le devis ─────────────────────────
router.post('/:token/refuse', async (req, res) => {
  try {
    const { reason, signer_name } = req.body || {};
    const quote = await db.get('SELECT * FROM quotes WHERE signature_token = $1', [req.params.token]);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });
    if (quote.signed_at) return res.status(409).json({ error: 'Ce devis a déjà été signé et ne peut plus être refusé.' });
    if (quote.status === 'refused') return res.status(409).json({ error: 'Ce devis a déjà été refusé.' });

    const safeReason = (reason || '').toString().slice(0, 1000);
    const safeSigner = (signer_name || '').toString().slice(0, 200);
    const now = new Date().toISOString();

    await db.run(
      "UPDATE quotes SET status = 'refused', refused_at = $1, refused_reason = $2, signer_name = COALESCE(NULLIF(signer_name, ''), $3) WHERE signature_token = $4",
      [now, safeReason, safeSigner, req.params.token]
    );

    // Arrêter les relances
    await db.run("UPDATE relances SET active=FALSE, next_send_at=NULL WHERE quote_id=$1", [quote.id]);

    // Notification au propriétaire
    await createNotification({
      user_id: quote.user_id,
      type: 'quote_refused',
      title: 'Devis refusé ✋',
      message: `${safeSigner || quote.client_name} a refusé le devis ${quote.number}.`,
      data: {
        quote_id: quote.id,
        quote_number: quote.number,
        client_name: quote.client_name,
        signer_name: safeSigner || quote.client_name,
        reason: safeReason,
        refused_at: now,
      },
    });

    res.json({ message: 'Devis refusé.', quote_number: quote.number });
  } catch(err) { console.error('refuse:', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

module.exports = router;
