'use strict';
const router = require('express').Router();
const { db } = require('../db/schema');

// ─── POST /api/webhooks/paypal/activate-manual (admin) ───────────────────────
router.post('/paypal/activate-manual', async (req, res) => {
  try {
    const { secret, email, plan } = req.body;
    if (!secret || secret !== process.env.JWT_SECRET)
      return res.status(403).json({ error: 'Non autorisé.' });
    if (!['starter','pro','team'].includes(plan))
      return res.status(400).json({ error: 'Plan invalide.' });
    if (!email) return res.status(400).json({ error: 'Email requis.' });

    const user = await db.get('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    await db.run('UPDATE users SET plan = $1 WHERE email = $2', [plan, email.toLowerCase()]);
    res.json({ message: `Plan ${plan} activé pour ${email}.` });
  } catch (err) {
    console.error('webhook manual:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
