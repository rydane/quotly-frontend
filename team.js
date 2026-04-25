'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto  = require('crypto');
const { db, nextQuoteNumber } = require('../db/schema');
const { requireAuth, requirePlan } = require('../middleware/auth');
const { checkQuoteLimit } = require('../middleware/planLimits');
const { generatePDF } = require('../services/pdf');
const { sendQuoteEmail } = require('../services/email');

const router = express.Router();

/** Récupère les settings de l'user */
function getSettings(userId) {
  return db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) || {};
}

// ─── GET /api/quotes ──────────────────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const { status, page = 1, limit = 20, search } = req.query;
  let query = 'WHERE q.user_id = ?';
  const params = [req.user.id];

  if (status) { query += ' AND q.status = ?'; params.push(status); }
  if (search) {
    query += ' AND (q.client_name LIKE ? OR q.number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const quotes = db.prepare(`
    SELECT q.*, s.signed_at
    FROM quotes q
    LEFT JOIN signatures s ON s.quote_id = q.id
    ${query}
    ORDER BY q.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM quotes q ${query}`).get(...params).cnt;

  res.json({ quotes, total, page: parseInt(page), limit: parseInt(limit) });
});

// ─── GET /api/quotes/:id ──────────────────────────────────────────────────────
router.get('/:id', requireAuth, (req, res) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

  quote.items = JSON.parse(quote.items || '[]');
  const sig = db.prepare('SELECT * FROM signatures WHERE quote_id = ?').get(quote.id);
  res.json({ quote, signature: sig || null });
});

// ─── POST /api/quotes ─────────────────────────────────────────────────────────
router.post('/', requireAuth, checkQuoteLimit, (req, res) => {
  try {
    const {
      client_name, client_address, client_email,
      company_name, items = [], tva_rate = 20,
      validity_days = 30, conditions, template_id = 'classic',
    } = req.body;

    if (!client_name) return res.status(400).json({ error: 'Nom du client requis.' });
    if (!company_name) return res.status(400).json({ error: 'Nom de votre entreprise requis.' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Au moins une prestation est requise.' });
    }


    // Restriction templates : starter = classique uniquement
    const PRO_TEMPLATES = ['moderne', 'artisan', 'minimal'];
    if (req.user.plan === 'starter' && template_id && PRO_TEMPLATES.includes(template_id.toLowerCase())) {
      return res.status(403).json({
        error: 'Les templates avancés sont réservés au plan Pro. Seul le template Classique est disponible gratuitement.',
        upgrade_url: 'https://quotly-frontend.vercel.app/#pricing',
      });
    }
    const id = uuidv4();
    const number = nextQuoteNumber(req.user.id);

    db.prepare(`
      INSERT INTO quotes (id, user_id, team_id, number, status, client_name, client_address,
        client_email, company_name, items, tva_rate, validity_days, conditions, template_id)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, req.user.id, req.user.team_id || null,
      number, client_name, client_address || null, client_email || null,
      company_name, JSON.stringify(items),
      parseFloat(tva_rate), parseInt(validity_days),
      conditions || null, template_id
    );

    // Incrémenter le compteur mensuel
    db.prepare('UPDATE users SET quotes_this_month = quotes_this_month + 1 WHERE id = ?')
      .run(req.user.id);

    const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
    quote.items = JSON.parse(quote.items);
    res.status(201).json({ quote, message: `Devis ${number} créé.` });
  } catch (err) {
    console.error('create quote:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── PUT /api/quotes/:id ──────────────────────────────────────────────────────
router.put('/:id', requireAuth, (req, res) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

  if (['accepted', 'refused'].includes(quote.status)) {
    return res.status(400).json({ error: 'Un devis signé ou refusé ne peut plus être modifié.' });
  }

  const {
    client_name, client_address, client_email,
    company_name, items, tva_rate, validity_days,
    conditions, template_id, status,
  } = req.body;

  db.prepare(`
    UPDATE quotes SET
      client_name     = COALESCE(?, client_name),
      client_address  = COALESCE(?, client_address),
      client_email    = COALESCE(?, client_email),
      company_name    = COALESCE(?, company_name),
      items           = COALESCE(?, items),
      tva_rate        = COALESCE(?, tva_rate),
      validity_days   = COALESCE(?, validity_days),
      conditions      = COALESCE(?, conditions),
      template_id     = COALESCE(?, template_id),
      status          = COALESCE(?, status),
      updated_at      = datetime('now')
    WHERE id = ?
  `).run(
    client_name || null, client_address || null, client_email || null,
    company_name || null, items ? JSON.stringify(items) : null,
    tva_rate != null ? parseFloat(tva_rate) : null,
    validity_days != null ? parseInt(validity_days) : null,
    conditions || null, template_id || null,
    status || null,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  updated.items = JSON.parse(updated.items);
  res.json({ quote: updated });
});

// ─── DELETE /api/quotes/:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, (req, res) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

  db.prepare('DELETE FROM quotes WHERE id = ?').run(req.params.id);
  res.json({ message: 'Devis supprimé.' });
});

// ─── GET /api/quotes/:id/pdf ──────────────────────────────────────────────────
router.get('/:id/pdf', requireAuth, async (req, res) => {
  try {
    const quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

    // Attacher la signature s'il y en a une
    const sig = db.prepare('SELECT signature_data FROM signatures WHERE quote_id = ?').get(quote.id);
    if (sig) quote.signature_data = sig.signature_data;

    quote.items = JSON.parse(quote.items);
    const settings = getSettings(req.user.id);
    const pdfBuffer = await generatePDF(quote, settings, 'quote');

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${quote.number}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('pdf error:', err);
    res.status(500).json({ error: 'Erreur génération PDF.' });
  }
});

// ─── POST /api/quotes/:id/send ────────────────────────────────────────────────
// Envoi du devis par email (Pro+)
router.post('/:id/send', requireAuth, requirePlan('pro', 'team'), async (req, res) => {
  try {
    const quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });

    const to = req.body.email || quote.client_email;
    if (!to) return res.status(400).json({ error: 'Email du client requis.' });

    // Générer un token de signature si pas encore fait
    if (!quote.signature_token) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + parseInt(process.env.SIGNATURE_TOKEN_EXPIRES_HOURS || 72) * 3600000);
      db.prepare(`UPDATE quotes SET signature_token = ?, token_expires_at = ?, status = 'sent', sent_at = datetime('now')
        WHERE id = ?`
      ).run(token, expires.toISOString(), quote.id);
      quote.signature_token = token;
    } else {
      db.prepare(`UPDATE quotes SET status = 'sent', sent_at = datetime('now') WHERE id = ?`).run(quote.id);
    }

    quote.items = JSON.parse(quote.items);
    const settings = getSettings(req.user.id);
    const pdfBuffer = await generatePDF(quote, settings, 'quote');

    const frontendUrl = process.env.FRONTEND_URL || 'https://quotly-devis.netlify.app';
    const signatureUrl = `${frontendUrl}/sign/${quote.signature_token}`;

    await sendQuoteEmail({
      to,
      senderName: req.user.name,
      quoteNumber: quote.number,
      pdfBuffer,
      signatureUrl,
      userId: req.user.id,
      quoteId: quote.id,
    });

    res.json({ message: `Devis envoyé à ${to}.`, signature_url: signatureUrl });
  } catch (err) {
    console.error('send quote:', err);
    res.status(500).json({ error: 'Erreur envoi email : ' + err.message });
  }
});

// ─── POST /api/quotes/:id/duplicate ──────────────────────────────────────────
router.post('/:id/duplicate', requireAuth, checkQuoteLimit, (req, res) => {
  const source = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!source) return res.status(404).json({ error: 'Devis introuvable.' });

  const id = uuidv4();
  const number = nextQuoteNumber(req.user.id);

  db.prepare(`
    INSERT INTO quotes (id, user_id, team_id, number, status, client_name, client_address,
      client_email, company_name, items, tva_rate, validity_days, conditions, template_id)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user.id, req.user.team_id || null, number,
    source.client_name, source.client_address, source.client_email,
    source.company_name, source.items, source.tva_rate,
    source.validity_days, source.conditions, source.template_id
  );

  db.prepare('UPDATE users SET quotes_this_month = quotes_this_month + 1 WHERE id = ?').run(req.user.id);

  const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  quote.items = JSON.parse(quote.items);
  res.status(201).json({ quote, message: `Devis ${number} créé par duplication.` });
});

module.exports = router;
