'use strict';
const jwt = require('jsonwebtoken');
const { db } = require('../db/schema');

/**
 * Middleware : vérifie le token JWT dans Authorization: Bearer <token>
 * Injecte req.user = { id, email, name, plan, team_id, role }
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token manquant. Veuillez vous connecter.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Vérifier que l'user existe encore en base
    const user = db.prepare(
      'SELECT id, email, name, plan, team_id, role FROM users WHERE id = ?'
    ).get(decoded.id);

    if (!user) {
      return res.status(401).json({ error: 'Compte introuvable ou supprimé.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expirée. Veuillez vous reconnecter.' });
    }
    return res.status(401).json({ error: 'Token invalide.' });
  }
}

/**
 * Middleware : s'assure que l'user a le plan requis
 * Usage : requirePlan('pro') ou requirePlan('team')
 */
function requirePlan(...plans) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié.' });
    if (plans.includes(req.user.plan)) return next();
    return res.status(403).json({
      error: `Cette fonctionnalité nécessite un plan ${plans.join(' ou ')}.`,
      upgrade_url: 'https://quotly-devis.netlify.app/#pricing',
    });
  };
}

/**
 * Middleware : seul le owner de l'équipe peut faire cette action
 */
function requireTeamOwner(req, res, next) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Réservé au propriétaire de l\'équipe.' });
  }
  next();
}

module.exports = { requireAuth, requirePlan, requireTeamOwner };
