'use strict';
const jwt = require('jsonwebtoken');
const { db } = require('../db/schema');

// Mini-cache mémoire pour éviter de taper la DB à chaque requête
// TTL court (15s) — suffisant pour réduire les hits DB de 80% sur le polling
const _userCache = new Map();
const CACHE_TTL = 15000; // 15 secondes

function getCachedUser(id) {
  const entry = _userCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { _userCache.delete(id); return null; }
  return entry.user;
}
function setCachedUser(id, user) {
  _userCache.set(id, { user, ts: Date.now() });
  // Nettoyage : max 200 entrées pour éviter les fuites mémoire
  if (_userCache.size > 200) {
    const oldest = _userCache.keys().next().value;
    _userCache.delete(oldest);
  }
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      return res.status(401).json({ error: 'Token manquant.' });

    const token = header.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Check cache first
    let user = getCachedUser(payload.id);
    if (!user) {
      user = await db.get('SELECT id, email, name, plan, role, team_id FROM users WHERE id = $1', [payload.id]);
      if (!user) return res.status(401).json({ error: 'Utilisateur introuvable.' });
      setCachedUser(payload.id, user);
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}

module.exports = { requireAuth };
