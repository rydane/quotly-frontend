'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { db }  = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { sendQuoteEmail } = require('../services/email');

// Plans: starter = 5 devis/mois, 5 signatures max total
const QUOTA_FREE_QUOTES     = 3;
const QUOTA_FREE_SIGNATURES = 3;

// Templates payants (côté backend — source de vérité)
const PRO_TEMPLATES = ['moderne', 'artisan', 'minimal', 'bold', 'blue_corp', 'tech',
  'nature', 'luxe', 'sante', 'immobilier', 'event', 'restaurant', 'auto', 'beaute',
  'juridique', 'archi', 'photo', 'transport', 'formation', 'nettoyage', 'it', 'mode'];

// ─── Middleware quota devis mensuel ───────────────────────────────────────────
async function checkQuota(req, res, next) {
  if (req.user.plan !== 'starter') return next();
  const user = await db.get('SELECT quotes_this_month, month_reset FROM users WHERE id = $1', [req.user.id]);
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (user.month_reset !== currentMonth) {
    await db.run('UPDATE users SET quotes_this_month = 0, month_reset = $1 WHERE id = $2', [currentMonth, req.user.id]);
    user.quotes_this_month = 0;
  }
  if (user.quotes_this_month >= QUOTA_FREE_QUOTES)
    return res.status(403).json({
      error: `Limite atteinte — ${QUOTA_FREE_QUOTES} devis/mois sur le plan gratuit. Passez au plan Pro pour des devis illimités.`,
      upgrade: true
    });
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

    // ✅ Vérification template côté backend
    const tplId = (template_id || 'classique').toLowerCase();
    if (req.user.plan === 'starter' && PRO_TEMPLATES.includes(tplId))
      return res.status(403).json({
        error: 'Ce template est réservé aux offres payantes. Passez à une offre premium pour l\'utiliser.',
        upgrade: true
      });

    const id = uuidv4();
    const count = await db.get('SELECT COUNT(*) as n FROM quotes WHERE user_id = $1', [req.user.id]);
    const number = `DEV-${String(parseInt(count.n || 0) + 1).padStart(4, '0')}`;
    const sigToken = uuidv4();

    await db.run(
      `INSERT INTO quotes (id, user_id, number, client_name, client_address, client_email, company_name, items, tva_rate, validity_days, conditions, template_id, signature_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, req.user.id, number, client_name, client_address || '', client_email || '', company_name,
       JSON.stringify(items), tva_rate || 20, validity_days || 30, conditions || '', tplId, sigToken]
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

// ─── PUT /api/quotes/:id ──────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const quote = await db.get('SELECT id FROM quotes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

    const { company_name, client_name, client_address, client_email, items, tva_rate, validity_days, conditions, template_id, status } = req.body;

    const tplId = template_id ? template_id.toLowerCase() : undefined;
    if (tplId && req.user.plan === 'starter' && PRO_TEMPLATES.includes(tplId))
      return res.status(403).json({ error: 'Template réservé aux offres payantes.', upgrade: true });

    const fields = [];
    const vals = [];
    if (company_name !== undefined) { fields.push(`company_name=$${fields.length+1}`); vals.push(company_name); }
    if (client_name !== undefined)  { fields.push(`client_name=$${fields.length+1}`); vals.push(client_name); }
    if (client_address !== undefined){ fields.push(`client_address=$${fields.length+1}`); vals.push(client_address); }
    if (client_email !== undefined)  { fields.push(`client_email=$${fields.length+1}`); vals.push(client_email); }
    if (items !== undefined)         { fields.push(`items=$${fields.length+1}`); vals.push(JSON.stringify(items)); }
    if (tva_rate !== undefined)      { fields.push(`tva_rate=$${fields.length+1}`); vals.push(tva_rate); }
    if (validity_days !== undefined) { fields.push(`validity_days=$${fields.length+1}`); vals.push(validity_days); }
    if (conditions !== undefined)    { fields.push(`conditions=$${fields.length+1}`); vals.push(conditions); }
    if (tplId !== undefined)         { fields.push(`template_id=$${fields.length+1}`); vals.push(tplId); }
    if (status !== undefined)        { fields.push(`status=$${fields.length+1}`); vals.push(status); }

    if (fields.length) {
      vals.push(req.params.id);
      await db.run(`UPDATE quotes SET ${fields.join(',')} WHERE id=$${vals.length}`, vals);
    }

    const updated = await db.get('SELECT * FROM quotes WHERE id = $1', [req.params.id]);
    res.json({ quote: updated });
  } catch (err) { console.error('update quote:', err); res.status(500).json({ error: 'Erreur serveur.' }); }
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

// ─── GET /api/quotes/:id/pdf ──────────────────────────────────────────────────
// ✅ Vérification backend : template payant bloque le téléchargement PDF
router.get('/:id/pdf', requireAuth, async (req, res) => {
  try {
    const quote = await db.get('SELECT * FROM quotes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

    const tplId = (quote.template_id || 'classique').toLowerCase();
    if (req.user.plan === 'starter' && PRO_TEMPLATES.includes(tplId))
      return res.status(403).json({
        error: 'Ce template est réservé aux offres payantes. Passez à une offre premium pour télécharger ce devis.',
        upgrade: true
      });

    const settings = await db.get('SELECT * FROM settings WHERE user_id = $1', [req.user.id]) || {};
    const { generatePDF } = require('../services/pdf');
    const pdfBuffer = await generatePDF(quote, settings, 'quote');

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${quote.number}.pdf"`,
    });
    res.send(pdfBuffer);
  } catch (err) { console.error('pdf:', err); res.status(500).json({ error: 'Erreur génération PDF.' }); }
});

// ─── POST /api/quotes/:id/send ────────────────────────────────────────────────
router.post('/:id/send', requireAuth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis.' });
    const quote = await db.get('SELECT * FROM quotes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

    const settings = await db.get('SELECT * FROM settings WHERE user_id = $1', [req.user.id]) || {};
    const { generatePDF } = require('../services/pdf');
    const pdfBuffer = await generatePDF(quote, settings, 'quote');

    const frontendUrl = process.env.FRONTEND_URL || 'https://quotly-frontend.vercel.app';
    const signatureUrl = `${frontendUrl}/sign/${quote.signature_token}`;

    await sendQuoteEmail({ to: email, senderName: req.user.name, quoteNumber: quote.number, pdfBuffer, signatureUrl, userId: req.user.id, quoteId: quote.id });
    await db.run("UPDATE quotes SET status = 'sent', client_email = $1 WHERE id = $2", [email, quote.id]);
    res.json({ message: `Devis envoyé à ${email}.`, signature_url: signatureUrl });
  } catch (err) { console.error('send quote:', err); res.status(500).json({ error: 'Erreur envoi email : ' + err.message }); }
});

// ─── POST /api/quotes/:id/duplicate ──────────────────────────────────────────
router.post('/:id/duplicate', requireAuth, checkQuota, async (req, res) => {
  try {
    const src = await db.get('SELECT * FROM quotes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!src) return res.status(404).json({ error: 'Devis introuvable.' });

    const id = uuidv4();
    const count = await db.get('SELECT COUNT(*) as n FROM quotes WHERE user_id = $1', [req.user.id]);
    const number = `DEV-${String(parseInt(count.n || 0) + 1).padStart(4, '0')}`;
    const sigToken = uuidv4();

    await db.run(
      `INSERT INTO quotes (id, user_id, number, client_name, client_address, client_email, company_name, items, tva_rate, validity_days, conditions, template_id, signature_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, req.user.id, number, src.client_name, src.client_address, src.client_email, src.company_name, src.items, src.tva_rate, src.validity_days, src.conditions, src.template_id, sigToken]
    );
    await db.run('UPDATE users SET quotes_this_month = quotes_this_month + 1 WHERE id = $1', [req.user.id]);
    const quote = await db.get('SELECT * FROM quotes WHERE id = $1', [id]);
    res.status(201).json({ quote });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

// ─── GET /api/quotes/quota ────────────────────────────────────────────────────
// Retourne l'état du quota pour le frontend
router.get('/quota/status', requireAuth, async (req, res) => {
  try {
    const user = await db.get('SELECT plan, quotes_this_month, month_reset, signatures_count FROM users WHERE id = $1', [req.user.id]);
    const currentMonth = new Date().toISOString().slice(0, 7);
    let quotesThisMonth = user.quotes_this_month || 0;
    if (user.month_reset !== currentMonth) quotesThisMonth = 0;

    res.json({
      plan: user.plan,
      quotes: {
        used: quotesThisMonth,
        limit: user.plan === 'starter' ? QUOTA_FREE_QUOTES : null,
        remaining: user.plan === 'starter' ? Math.max(0, QUOTA_FREE_QUOTES - quotesThisMonth) : null,
      },
      signatures: {
        used: user.signatures_count || 0,
        limit: user.plan === 'starter' ? QUOTA_FREE_SIGNATURES : null,
        remaining: user.plan === 'starter' ? Math.max(0, QUOTA_FREE_SIGNATURES - (user.signatures_count || 0)) : null,
      }
    });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

module.exports = router;
