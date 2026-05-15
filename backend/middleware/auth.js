'use strict';
const jwt = require('jsonwebtoken');
const { db } = require('../db/schema');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      return res.status(401).json({ error: 'Token manquant.' });

    const token = header.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await db.get('SELECT id, email, name, plan, role, team_id FROM users WHERE id = $1', [payload.id]);
    if (!user) return res.status(401).json({ error: 'Utilisateur introuvable.' });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}

module.exports = { requireAuth };
