'use strict';
const { db, checkMonthReset } = require('../db/schema');

/** Limites par plan */
const LIMITS = {
  starter: { quotes_per_month: 5, templates: 1 },
  pro:     { quotes_per_month: Infinity, templates: 20 },
  team:    { quotes_per_month: Infinity, templates: 20 },
};

/**
 * Vérifie que l'user n'a pas dépassé sa limite mensuelle de devis.
 * À placer avant la création d'un devis.
 */
function checkQuoteLimit(req, res, next) {
  const { id, plan } = req.user;
  checkMonthReset(id);

  const user = db.prepare('SELECT quotes_this_month, plan FROM users WHERE id = ?').get(id);
  const limit = LIMITS[user.plan]?.quotes_per_month ?? 5;

  if (user.quotes_this_month >= limit) {
    return res.status(429).json({
      error: `Limite atteinte ! Vous avez utilisé vos ${limit} devis gratuits ce mois-ci.`,
      limit,
      current: user.quotes_this_month,
      upgrade_url: 'https://quotly-devis.netlify.app/#pricing',
    });
  }
  next();
}

module.exports = { checkQuoteLimit, LIMITS };
