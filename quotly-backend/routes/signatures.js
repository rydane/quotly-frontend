'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { sendSignatureNotification } = require('../services/email');

const router = express.Router();

/**
 * GET /api/sign/:token
 * Page publique – récupère les infos du devis pour affichage au client
 */
router.get('/:token', (req, res) => {
  const quote = db.prepare(`
    SELECT q.id, q.number, q.client_name, q.company_name, q.items,
           q.tva_rate, q.validity_days, q.status, q.token_expires_at, q.conditions,
           u.name as sender_name
    FROM quotes q
    JOIN users u ON u.id = q.user_id
    WHERE q.signature_token = ?
  `).get(req.params.token);

  if (!quote) {
    return res.status(404).json({ error: 'Lien de signature invalide ou expiré.' });
  }
  if (new Date(quote.token_expires_at) < new Date()) {
    return res.status(410).json({ error: 'Ce lien de signature a expiré.' });
  }
  if (quote.status === 'accepted') {
    return res.status(409).json({ error: 'Ce devis a déjà été signé.' });
  }
  if (quote.status === 'refused') {
    return res.status(409).json({ error: 'Ce devis a déjà été refusé.' });
  }

  quote.items = JSON.parse(quote.items || '[]');
  res.json({ quote });
});

/**
 * POST /api/sign/:token
 * Le client soumet sa signature (tracé base64 + nom)
 */
router.post('/:token', async (req, res) => {
  try {
    const { signer_name, signer_email, signature_data, action } = req.body;
    // action = 'accept' | 'refuse'

    const quote = db.prepare(`
      SELECT q.*, u.email as owner_email, u.name as owner_name
      FROM quotes q
      JOIN users u ON u.id = q.user_id
      WHERE q.signature_token = ?
    `).get(req.params.token);

    if (!quote) return res.status(404).json({ error: 'Lien invalide.' });
    if (new Date(quote.token_expires_at) < new Date()) {
      return res.status(410).json({ error: 'Lien expiré.' });
    }
    if (['accepted', 'refused'].includes(quote.status)) {
      return res.status(409).json({ error: 'Devis déjà traité.' });
    }

    if (action === 'refuse') {
      db.prepare(`UPDATE quotes SET status = 'refused', refused_at = datetime('now') WHERE id = ?`)
        .run(quote.id);
      return res.json({ message: 'Devis refusé.' });
    }

    // Acceptation + signature
    if (!signer_name) return res.status(400).json({ error: 'Nom du signataire requis.' });
    if (!signature_data) return res.status(400).json({ error: 'Signature requise.' });

    const sigId = uuidv4();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

    db.prepare(`
      INSERT INTO signatures (id, quote_id, signer_name, signer_email, signer_ip, signature_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sigId, quote.id, signer_name, signer_email || null, ip, signature_data);

    db.prepare(`
      UPDATE quotes SET status = 'accepted', accepted_at = datetime('now') WHERE id = ?
    `).run(quote.id);

    // Notifier le propriétaire du devis
    sendSignatureNotification({
      to: quote.owner_email,
      senderName: quote.owner_name,
      quoteNumber: quote.number,
      signerName: signer_name,
    }).catch(console.error);

    res.json({
      message: 'Merci ! Votre signature a été enregistrée.',
      signature_id: sigId,
      accepted_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('sign error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * GET /api/sign/status/:quoteId  (authentifié – pour le pro)
 */
router.get('/status/:quoteId', requireAuth, (req, res) => {
  const quote = db.prepare('SELECT id, status, accepted_at, refused_at FROM quotes WHERE id = ? AND user_id = ?')
    .get(req.params.quoteId, req.user.id);
  if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

  const sig = db.prepare('SELECT signer_name, signer_email, signed_at FROM signatures WHERE quote_id = ?')
    .get(quote.id);

  res.json({ status: quote.status, accepted_at: quote.accepted_at, signature: sig || null });
});

module.exports = router;
