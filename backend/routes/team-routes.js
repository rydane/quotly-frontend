'use strict';
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db/schema');

function ownerOnly(req, res, next) {
  if (req.user.plan !== 'team')
    return res.status(403).json({ error: 'Accès réservé au plan Équipe.' });
  if (req.user.role === 'member')
    return res.status(403).json({ error: 'Seul le compte principal peut gérer les membres.' });
  next();
}

// GET /api/team/members
router.get('/team/members', requireAuth, async (req, res) => {
  if (req.user.plan !== 'team')
    return res.status(403).json({ error: 'Accès réservé au plan Équipe.' });
  try {
    const ownerId = req.user.role === 'owner' ? req.user.id : req.user.team_id;
    const members = await db.all(
      'SELECT id, name, email, role, created_at FROM users WHERE team_id = $1 ORDER BY created_at ASC',
      [ownerId]
    );
    res.json({ members });
  } catch (e) {
    console.error('[GET /team/members]', e.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/team/members — crée un vrai compte persistant dans users
router.post('/team/members', requireAuth, ownerOnly, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ error: 'Nom, email et mot de passe (min. 6 car.) requis.' });
  try {
    const { n } = await db.get(
      'SELECT COUNT(*) AS n FROM users WHERE team_id = $1', [req.user.id]
    );
    if (parseInt(n) >= 5)
      return res.status(400).json({ error: 'Limite de 5 comptes atteinte.' });

    const existing = await db.get(
      'SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]
    );
    if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé.' });

    const id   = uuidv4();
    const hash = await bcrypt.hash(password, 12);
    await db.run(
      "INSERT INTO users (id, email, name, password_hash, plan, role, team_id) VALUES ($1,$2,$3,$4,'team','member',$5)",
      [id, email.toLowerCase().trim(), name.trim(), hash, req.user.id]
    );
    const member = await db.get(
      'SELECT id, name, email, role, created_at FROM users WHERE id = $1', [id]
    );
    res.status(201).json({ member });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    console.error('[POST /team/members]', e.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/team/members/:id — suppression définitive
router.delete('/team/members/:id', requireAuth, ownerOnly, async (req, res) => {
  try {
    const member = await db.get(
      'SELECT id, team_id FROM users WHERE id = $1', [req.params.id]
    );
    if (!member || member.team_id !== req.user.id)
      return res.status(404).json({ error: 'Membre introuvable.' });

    await db.run('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('[DELETE /team/members/:id]', e.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Conservé pour compatibilité avec server.js
async function initTeamTable() {}

module.exports = { router, initTeamTable };
