'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

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

    // ── Créer une notification pour l'entreprise ────────────────────────────
    const notifId = uuidv4();
    const signerDisplay = signer_name ? signer_name : 'Votre client';
    await db.run(
      `INSERT INTO notifications (id, user_id, type, title, message, quote_id)
       VALUES ($1, $2, 'quote_signed', $3, $4, $5)`,
      [
        notifId,
        quote.user_id,
        '✍️ Devis signé !',
        `${signerDisplay} a signé le devis ${quote.number}. Il est maintenant accepté.`,
        quote.id
      ]
    );

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

module.exports = router;
