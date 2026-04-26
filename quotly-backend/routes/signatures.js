'use strict';
const router = require('express').Router();
const { db } = require('../db/schema');

// GET /api/signatures/:token — page publique de signature
router.get('/:token', async (req, res) => {
  try {
    const quote = await db.get('SELECT * FROM quotes WHERE signature_token = $1', [req.params.token]);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable ou lien expiré.' });
    res.json({ quote });
  } catch(err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

// POST /api/signatures/:token — signer le devis
router.post('/:token', async (req, res) => {
  try {
    const { signature_data, signer_name } = req.body;
    if (!signature_data) return res.status(400).json({ error: 'Signature manquante.' });

    const quote = await db.get('SELECT * FROM quotes WHERE signature_token = $1', [req.params.token]);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });
    if (quote.signed_at) return res.status(409).json({ error: 'Ce devis est déjà signé.' });

    await db.run(
      "UPDATE quotes SET signature_data = $1, signed_at = NOW(), status = 'accepted' WHERE signature_token = $2",
      [signature_data, req.params.token]
    );

    res.json({ message: 'Devis signé avec succès.', quote_number: quote.number });
  } catch(err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

module.exports = router;
