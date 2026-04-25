'use strict';
const express = require('express');
const { db } = require('../db/schema');
const { requireAuth, requirePlan } = require('../middleware/auth');
const { computeTotals } = require('../services/pdf');

const router = express.Router();

/**
 * GET /api/stats
 * Tableau de bord : CA, taux d'acceptation, devis en attente, etc.
 */
router.get('/', requireAuth, requirePlan('pro', 'team'), (req, res) => {
  const uid = req.user.id;

  // ── Devis ─────────────────────────────────────────────────────────────────
  const allQuotes = db.prepare(
    `SELECT status, items, tva_rate, created_at, accepted_at FROM quotes WHERE user_id = ?`
  ).all(uid);

  const total     = allQuotes.length;
  const accepted  = allQuotes.filter(q => q.status === 'accepted').length;
  const sent      = allQuotes.filter(q => q.status === 'sent').length;
  const refused   = allQuotes.filter(q => q.status === 'refused').length;
  const draft     = allQuotes.filter(q => q.status === 'draft').length;
  const expired   = allQuotes.filter(q => q.status === 'expired').length;

  const acceptanceRate = total > 0 ? Math.round((accepted / (total - draft)) * 100) || 0 : 0;

  // CA prévisionnel (devis envoyés ou acceptés)
  let caPrevi = 0;
  allQuotes
    .filter(q => ['sent', 'accepted'].includes(q.status))
    .forEach(q => {
      const items = JSON.parse(q.items || '[]');
      const { totalTTC } = computeTotals(items, q.tva_rate);
      caPrevi += totalTTC;
    });

  // CA réalisé (devis acceptés)
  let caRealise = 0;
  allQuotes
    .filter(q => q.status === 'accepted')
    .forEach(q => {
      const items = JSON.parse(q.items || '[]');
      const { totalTTC } = computeTotals(items, q.tva_rate);
      caRealise += totalTTC;
    });

  // ── Factures ──────────────────────────────────────────────────────────────
  const allInvoices = db.prepare(
    `SELECT status, items, tva_rate FROM invoices WHERE user_id = ?`
  ).all(uid);

  let invoicedTotal = 0;
  let paidTotal = 0;
  allInvoices.forEach(inv => {
    const items = JSON.parse(inv.items || '[]');
    const { totalTTC } = computeTotals(items, inv.tva_rate);
    invoicedTotal += totalTTC;
    if (inv.status === 'paid') paidTotal += totalTTC;
  });

  // ── Évolution mensuelle (12 derniers mois) ────────────────────────────────
  const monthly = db.prepare(`
    SELECT
      strftime('%Y-%m', created_at) as month,
      COUNT(*) as count,
      SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted
    FROM quotes
    WHERE user_id = ?
      AND created_at >= datetime('now', '-12 months')
    GROUP BY month
    ORDER BY month
  `).all(uid);

  // ── Derniers devis ────────────────────────────────────────────────────────
  const recentQuotes = db.prepare(`
    SELECT id, number, client_name, status, created_at, items, tva_rate
    FROM quotes WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
  `).all(uid).map(q => {
    const items = JSON.parse(q.items || '[]');
    const { totalTTC } = computeTotals(items, q.tva_rate);
    return { ...q, totalTTC: Math.round(totalTTC * 100) / 100 };
  });

  // ── Limite plan ──────────────────────────────────────────────────────────
  const user = db.prepare('SELECT plan, quotes_this_month FROM users WHERE id = ?').get(uid);
  const limits = { starter: 5, pro: null, team: null };
  const monthLimit = limits[user.plan] ?? null;

  res.json({
    quotes: { total, accepted, sent, refused, draft, expired, acceptanceRate },
    revenue: {
      caPrevi:    Math.round(caPrevi * 100) / 100,
      caRealise:  Math.round(caRealise * 100) / 100,
      invoiced:   Math.round(invoicedTotal * 100) / 100,
      paid:       Math.round(paidTotal * 100) / 100,
    },
    monthly,
    recentQuotes,
    plan: {
      current: user.plan,
      quotesThisMonth: user.quotes_this_month,
      monthLimit,
    },
  });
});

/**
 * GET /api/stats/email-logs
 */
router.get('/email-logs', requireAuth, (req, res) => {
  const logs = db.prepare(`
    SELECT * FROM email_logs WHERE user_id = ? ORDER BY sent_at DESC LIMIT 50
  `).all(req.user.id);
  res.json({ logs });
});

module.exports = router;
