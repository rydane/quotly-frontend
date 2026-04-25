'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db, nextInvoiceNumber } = require('../db/schema');
const { requireAuth, requirePlan } = require('../middleware/auth');
const { generatePDF } = require('../services/pdf');
const { sendInvoiceEmail } = require('../services/email');

const router = express.Router();

function getSettings(userId) {
  return db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) || {};
}

// ─── GET /api/invoices ────────────────────────────────────────────────────────
router.get('/', requireAuth, requirePlan('pro', 'team'), (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  let query = 'WHERE user_id = ?';
  const params = [req.user.id];
  if (status) { query += ' AND status = ?'; params.push(status); }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const invoices = db.prepare(
    `SELECT * FROM invoices ${query} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, parseInt(limit), offset);
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM invoices ${query}`).get(...params).cnt;

  res.json({ invoices, total });
});

// ─── GET /api/invoices/:id ────────────────────────────────────────────────────
router.get('/:id', requireAuth, requirePlan('pro', 'team'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!inv) return res.status(404).json({ error: 'Facture introuvable.' });
  inv.items = JSON.parse(inv.items);
  res.json({ invoice: inv });
});

// ─── POST /api/invoices ───────────────────────────────────────────────────────
router.post('/', requireAuth, requirePlan('pro', 'team'), (req, res) => {
  try {
    const {
      client_name, client_address, client_email, company_name,
      items = [], tva_rate = 20, due_days = 30, conditions,
    } = req.body;

    if (!client_name || !company_name || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Champs requis manquants.' });
    }

    const id = uuidv4();
    const number = nextInvoiceNumber(req.user.id);

    db.prepare(`
      INSERT INTO invoices (id, user_id, team_id, number, status, client_name, client_address,
        client_email, company_name, items, tva_rate, due_days, conditions)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, req.user.id, req.user.team_id || null,
      number, client_name, client_address || null, client_email || null,
      company_name, JSON.stringify(items),
      parseFloat(tva_rate), parseInt(due_days), conditions || null
    );

    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    inv.items = JSON.parse(inv.items);
    res.status(201).json({ invoice: inv });
  } catch (err) {
    console.error('create invoice:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── POST /api/invoices/from-quote/:quoteId ───────────────────────────────────
// Conversion devis → facture en 1 clic (fonctionnalité pro phare)
router.post('/from-quote/:quoteId', requireAuth, requirePlan('pro', 'team'), (req, res) => {
  try {
    const quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?')
      .get(req.params.quoteId, req.user.id);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });
    if (quote.status !== 'accepted') {
      return res.status(400).json({
        error: 'Seul un devis accepté peut être converti en facture.',
        status: quote.status,
      });
    }

    // Vérifier qu'une facture n'existe pas déjà
    const existing = db.prepare('SELECT id, number FROM invoices WHERE quote_id = ?').get(quote.id);
    if (existing) {
      return res.status(409).json({
        error: 'Une facture existe déjà pour ce devis.',
        invoice_id: existing.id,
        invoice_number: existing.number,
      });
    }

    const id = uuidv4();
    const number = nextInvoiceNumber(req.user.id);

    db.prepare(`
      INSERT INTO invoices (id, user_id, team_id, quote_id, number, status, client_name,
        client_address, client_email, company_name, items, tva_rate, due_days, conditions)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, 30, ?)
    `).run(
      id, req.user.id, req.user.team_id || null, quote.id,
      number, quote.client_name, quote.client_address,
      quote.client_email, quote.company_name, quote.items,
      quote.tva_rate, quote.conditions
    );

    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    inv.items = JSON.parse(inv.items);
    res.status(201).json({
      invoice: inv,
      message: `Facture ${number} créée depuis le devis ${quote.number}.`,
    });
  } catch (err) {
    console.error('from-quote:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── PUT /api/invoices/:id ────────────────────────────────────────────────────
router.put('/:id', requireAuth, requirePlan('pro', 'team'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!inv) return res.status(404).json({ error: 'Facture introuvable.' });
  if (inv.status === 'paid') return res.status(400).json({ error: 'Une facture payée ne peut plus être modifiée.' });

  const { client_name, client_address, client_email, company_name, items, tva_rate, due_days, conditions, status } = req.body;

  db.prepare(`
    UPDATE invoices SET
      client_name    = COALESCE(?, client_name),
      client_address = COALESCE(?, client_address),
      client_email   = COALESCE(?, client_email),
      company_name   = COALESCE(?, company_name),
      items          = COALESCE(?, items),
      tva_rate       = COALESCE(?, tva_rate),
      due_days       = COALESCE(?, due_days),
      conditions     = COALESCE(?, conditions),
      status         = COALESCE(?, status),
      paid_at        = CASE WHEN ? = 'paid' THEN datetime('now') ELSE paid_at END,
      sent_at        = CASE WHEN ? = 'sent' THEN datetime('now') ELSE sent_at END,
      updated_at     = datetime('now')
    WHERE id = ?
  `).run(
    client_name || null, client_address || null, client_email || null,
    company_name || null, items ? JSON.stringify(items) : null,
    tva_rate != null ? parseFloat(tva_rate) : null,
    due_days != null ? parseInt(due_days) : null,
    conditions || null, status || null,
    status || null, status || null,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  updated.items = JSON.parse(updated.items);
  res.json({ invoice: updated });
});

// ─── DELETE /api/invoices/:id ─────────────────────────────────────────────────
router.delete('/:id', requireAuth, requirePlan('pro', 'team'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!inv) return res.status(404).json({ error: 'Facture introuvable.' });
  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  res.json({ message: 'Facture supprimée.' });
});

// ─── GET /api/invoices/:id/pdf ────────────────────────────────────────────────
router.get('/:id/pdf', requireAuth, requirePlan('pro', 'team'), async (req, res) => {
  try {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Facture introuvable.' });

    inv.items = JSON.parse(inv.items);
    const settings = getSettings(req.user.id);
    const pdfBuffer = await generatePDF(inv, settings, 'invoice');

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${inv.number}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('invoice pdf:', err);
    res.status(500).json({ error: 'Erreur PDF.' });
  }
});

// ─── POST /api/invoices/:id/send ──────────────────────────────────────────────
router.post('/:id/send', requireAuth, requirePlan('pro', 'team'), async (req, res) => {
  try {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Facture introuvable.' });

    const to = req.body.email || inv.client_email;
    if (!to) return res.status(400).json({ error: 'Email du client requis.' });

    inv.items = JSON.parse(inv.items);
    const settings = getSettings(req.user.id);
    const pdfBuffer = await generatePDF(inv, settings, 'invoice');

    await sendInvoiceEmail({
      to, senderName: req.user.name,
      invoiceNumber: inv.number,
      pdfBuffer, userId: req.user.id, invoiceId: inv.id,
    });

    db.prepare(`UPDATE invoices SET status = 'sent', sent_at = datetime('now') WHERE id = ?`)
      .run(inv.id);

    res.json({ message: `Facture envoyée à ${to}.` });
  } catch (err) {
    console.error('send invoice:', err);
    res.status(500).json({ error: 'Erreur envoi : ' + err.message });
  }
});

module.exports = router;
