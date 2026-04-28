'use strict';
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { requireAuth } = require('../middleware/auth');
const { db }          = require('../db/schema');

// Crée la table team_members si elle n'existe pas encore
async function initTeamTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS team_members (
      id           TEXT PRIMARY KEY,
      owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      email        TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('✅ Table team_members prête');
}

// ── GET /api/team/members ─────────────────────────────────────
router.get('/team/members', requireAuth, async (req, res) => {
  if (req.user.plan !== 'team') {
    return res.status(403).json({ error: 'Accès réservé au plan Équipe' });
  }
  try {
    const members = await db.all(
      'SELECT id, name, email, created_at FROM team_members WHERE owner_id = $1 ORDER BY created_at ASC',
      [req.user.id]
    );
    res.json({ members });
  } catch (e) {
    console.error('[team/members GET]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /api/team/members ────────────────────────────────────
router.post('/team/members', requireAuth, async (req, res) => {
  if (req.user.plan !== 'team') {
    return res.status(403).json({ error: 'Accès réservé au plan Équipe' });
  }
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Nom, email et mot de passe (min. 6 car.) requis' });
  }
  try {
    // Limite 5 membres
    const row = await db.get(
      'SELECT COUNT(*) AS count FROM team_members WHERE owner_id = $1',
      [req.user.id]
    );
    if (parseInt(row.count) >= 5) {
      return res.status(400).json({ error: 'Limite de 5 comptes atteinte' });
    }

    const id   = require('crypto').randomUUID();
    const hash = await bcrypt.hash(password, 10);
    const member = await db.get(
      'INSERT INTO team_members (id, owner_id, name, email, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, created_at',
      [id, req.user.id, name.trim(), email.toLowerCase().trim(), hash]
    );
    res.status(201).json({ member });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    }
    console.error('[team/members POST]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── DELETE /api/team/members/:id ──────────────────────────────
router.delete('/team/members/:id', requireAuth, async (req, res) => {
  if (req.user.plan !== 'team') {
    return res.status(403).json({ error: 'Accès réservé au plan Équipe' });
  }
  try {
    const result = await db.run(
      'DELETE FROM team_members WHERE id = $1 AND owner_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Membre introuvable' });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('[team/members DELETE]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = { router, initTeamTable };
