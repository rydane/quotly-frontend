'use strict';
const router = require('express').Router();
const { db } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;

    const quotesRow = await db.get(`
      SELECT
        COUNT(*) FILTER (WHERE TRUE) as total,
        COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'refused') as refused
      FROM quotes WHERE user_id = $1`, [uid]);

    const revRow = await db.get(`
      SELECT
        COALESCE(SUM(
          CASE WHEN status = 'accepted' THEN
            (SELECT COALESCE(SUM((item->>'qty')::numeric * (item->>'unit_price')::numeric),0) FROM jsonb_array_elements(items) item)
            * (1 + tva_rate/100)
          ELSE 0 END
        ), 0) as ca_realise,
        COALESCE(SUM(
          (SELECT COALESCE(SUM((item->>'qty')::numeric * (item->>'unit_price')::numeric),0) FROM jsonb_array_elements(items) item)
          * (1 + tva_rate/100)
        ), 0) as ca_previ
      FROM quotes WHERE user_id = $1`, [uid]);

    const total = parseInt(quotesRow.total) || 0;
    const accepted = parseInt(quotesRow.accepted) || 0;

    const recentQuotes = await db.all(`
      SELECT id, number, status, client_name, created_at,
        (SELECT COALESCE(SUM((item->>'qty')::numeric * (item->>'unit_price')::numeric),0) FROM jsonb_array_elements(items) item) * (1 + tva_rate/100) as "totalTTC"
      FROM quotes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`, [uid]);

    const user = await db.get('SELECT plan, quotes_this_month FROM users WHERE id = $1', [uid]);

    res.json({
      quotes: {
        total, accepted,
        sent: parseInt(quotesRow.sent) || 0,
        refused: parseInt(quotesRow.refused) || 0,
        acceptanceRate: total ? Math.round(accepted / total * 100) : 0,
      },
      revenue: {
        caRealise: parseFloat(revRow.ca_realise) || 0,
        caPrevi:   parseFloat(revRow.ca_previ) || 0,
      },
      recentQuotes,
      plan: {
        current: user.plan,
        quotesThisMonth: user.quotes_this_month,
        monthLimit: user.plan === 'starter' ? 5 : null,
      },
    });
  } catch (err) {
    console.error('stats:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
