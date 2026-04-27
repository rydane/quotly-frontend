'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { db } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

function requireTeam(req, res, next) {
  if (req.user.plan !== 'team') return res.status(403).json({ error: 'Plan Équipe requis.' });
  next();
}

// GET /api/team — membres de l'équipe
router.get('/', requireAuth, requireTeam, async (req, res) => {
  try {
    const members = await db.all(
      'SELECT id, name, email, role, created_at FROM users WHERE team_id = $1 ORDER BY created_at ASC',
      [req.user.team_id || req.user.id]
    );
    res.json({ members });
  } catch(err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

// POST /api/team/invite — inviter un membre
router.post('/invite', requireAuth, requireTeam, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Champs manquants.' });

    const teamId = req.user.team_id || req.user.id;
    const count = await db.get('SELECT COUNT(*) as n FROM users WHERE team_id = $1', [teamId]);
    if (parseInt(count.n) >= 5) return res.status(403).json({ error: 'Maximum 5 membres par équipe.' });

    const existing = await db.get('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'Email déjà utilisé.' });

    const hash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    await db.run(
      "INSERT INTO users (id, email, name, password_hash, plan, role, team_id) VALUES ($1,$2,$3,$4,'team','member',$5)",
      [id, email.toLowerCase(), name, hash, teamId]
    );

    res.status(201).json({ message: `${name} ajouté à l'équipe.` });
  } catch(err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

// DELETE /api/team/:memberId — retirer un membre
router.delete('/:memberId', requireAuth, requireTeam, async (req, res) => {
  try {
    const member = await db.get('SELECT id, team_id FROM users WHERE id = $1', [req.params.memberId]);
    if (!member) return res.status(404).json({ error: 'Membre introuvable.' });
    if (member.id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas vous retirer vous-même.' });

    await db.run("UPDATE users SET team_id = NULL, plan = 'starter', role = 'owner' WHERE id = $1", [req.params.memberId]);
    res.json({ message: 'Membre retiré.' });
  } catch(err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

module.exports = router;
