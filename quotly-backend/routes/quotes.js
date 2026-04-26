'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { db }  = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { sendQuoteEmail } = require('../services/email');

const QUOTA_FREE = 5;
const PRO_TEMPLATES = ['moderne', 'artisan', 'minimal'];

// ─── Middleware quota ─────────────────────────────────────────────────────────
async function checkQuota(req, res, next) {
  if (req.user.plan !== 'starter') return next();
  const user = await db.get('SELECT quotes_this_month, month_reset FROM users WHERE id = $1', [req.user.id]);
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (user.month_reset !== currentMonth) {
    await db.run('UPDATE users SET quotes_this_month = 0, month_reset = $1 WHERE id = $2', [currentMonth, req.user.id]);
    user.quotes_this_month = 0;
  }
  if (user.quotes_this_month >= QUOTA_FREE)
    return res.status(403).json({ error: `Quota atteint (${QUOTA_FREE} devis/mois sur le plan Starter). Passez au plan Pro pour des devis illimités.`, upgrade: true });
  next();
}

// ─── GET /api/quotes ──────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const rows = await db.all(
      'SELECT id, number, status, client_name, company_name, items, tva_rate, created_at FROM quotes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    const quotes = rows.map(q => {
      const items = typeof q.items === 'string' ? JSON.parse(q.items) : q.items;
      const ht  = items.reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0), 0);
      const ttc = ht * (1 + (q.tva_rate || 20) / 100);
      return { ...q, totalHT: ht, totalTTC: ttc };
    });
    res.json({ quotes });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

// ─── POST /api/quotes ─────────────────────────────────────────────────────────
router.post('/', requireAuth, checkQuota, async (req, res) => {
  try {
    const { company_name, client_name, client_address, client_email, items, tva_rate, validity_days, conditions, template_id } = req.body;
    if (!client_name) return res.status(400).json({ error: 'Nom du client requis.' });
    if (!company_name) return res.status(400).json({ error: 'Nom entreprise requis.' });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Au moins une prestation requise.' });
    if (req.user.plan === 'starter' && template_id && PRO_TEMPLATES.includes(template_id.toLowerCase()))
      return res.status(403).json({ error: 'Templates avancés réservés au plan Pro.', upgrade: true });

    const id = uuidv4();
    const count = await db.get('SELECT COUNT(*) as n FROM quotes WHERE user_id = $1', [req.user.id]);
    const number = `DEV-${String(parseInt(count.n || 0) + 1).padStart(4, '0')}`;
    const sigToken = uuidv4();

    await db.run(
      `INSERT INTO quotes (id, user_id, number, client_name, client_address, client_email, company_name, items, tva_rate, validity_days, conditions, template_id, signature_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, req.user.id, number, client_name, client_address || '', client_email || '', company_name,
       JSON.stringify(items), tva_rate || 20, validity_days || 30, conditions || '', template_id || 'classique', sigToken]
    );

    await db.run('UPDATE users SET quotes_this_month = quotes_this_month + 1 WHERE id = $1', [req.user.id]);

    const quote = await db.get('SELECT * FROM quotes WHERE id = $1', [id]);
    res.status(201).json({ quote });
  } catch (err) { console.error('create quote:', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

// ─── GET /api/quotes/:id ──────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const quote = await db.get('SELECT * FROM quotes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });
    res.json({ quote });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

// ─── DELETE /api/quotes/:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const quote = await db.get('SELECT id FROM quotes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });
    await db.run('DELETE FROM quotes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Devis supprimé.' });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

// ─── POST /api/quotes/:id/send ────────────────────────────────────────────────
router.post('/:id/send', requireAuth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis.' });
    const quote = await db.get('SELECT * FROM quotes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

    const frontendUrl = process.env.FRONTEND_URL || 'https://quotly-frontend.vercel.app';
    const signatureUrl = `${frontendUrl}/sign/${quote.signature_token}`;

    await sendQuoteEmail({ to: email, senderName: req.user.name, quoteNumber: quote.number, pdfBuffer: Buffer.from(''), signatureUrl, userId: req.user.id, quoteId: quote.id });
    await db.run("UPDATE quotes SET status = 'sent', client_email = $1 WHERE id = $2", [email, quote.id]);
    res.json({ message: `Devis envoyé à ${email}.`, signature_url: signatureUrl });
  } catch (err) { console.error('send quote:', err); res.status(500).json({ error: 'Erreur envoi email : ' + err.message }); }
});

module.exports = router;
