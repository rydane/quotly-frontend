'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { db } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

function requireTeam(req, res, next) {
  if (req.user.plan !== 'team')
    return res.status(403).json({ error: 'Plan Équipe requis.' });
  next();
}

// Seul le propriétaire (role='owner') peut gérer les membres
function ownerOnly(req, res, next) {
  if (req.user.role === 'member')
    return res.status(403).json({ error: 'Seul le compte principal peut gérer les membres.' });
  next();
}

// GET /api/team
router.get('/', requireAuth, requireTeam, async (req, res) => {
  try {
    const ownerId = req.user.role === 'owner' ? req.user.id : req.user.team_id;
    const members = await db.all(
      'SELECT id, name, email, role, created_at FROM users WHERE team_id = $1 ORDER BY created_at ASC',
      [ownerId]
    );
    res.json({ members });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

// POST /api/team/invite — crée un vrai compte utilisateur secondaire
router.post('/invite', requireAuth, requireTeam, ownerOnly, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Champs manquants.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Mot de passe trop court (min. 6 car.).' });

    const count = await db.get(
      'SELECT COUNT(*) as n FROM users WHERE team_id = $1', [req.user.id]
    );
    if (parseInt(count.n) >= 5)
      return res.status(403).json({ error: 'Maximum 5 membres par équipe.' });

    const existing = await db.get(
      'SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]
    );
    if (existing) return res.status(409).json({ error: 'Email déjà utilisé.' });

    const hash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    await db.run(
      "INSERT INTO users (id, email, name, password_hash, plan, role, team_id) VALUES ($1,$2,$3,$4,'team','member',$5)",
      [id, email.toLowerCase().trim(), name.trim(), hash, req.user.id]
    );

    const member = await db.get(
      'SELECT id, name, email, role, created_at FROM users WHERE id = $1', [id]
    );
    res.status(201).json({ message: `${name} ajouté à l'équipe.`, member });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email déjà utilisé.' });
    console.error('[POST /team/invite]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/team/:memberId — suppression définitive du compte secondaire
router.delete('/:memberId', requireAuth, requireTeam, ownerOnly, async (req, res) => {
  try {
    const member = await db.get(
      'SELECT id, team_id FROM users WHERE id = $1', [req.params.memberId]
    );
    if (!member)
      return res.status(404).json({ error: 'Membre introuvable.' });
    if (member.id === req.user.id)
      return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
    if (member.team_id !== req.user.id)
      return res.status(403).json({ error: "Ce membre n'appartient pas à votre équipe." });

    await db.run('DELETE FROM users WHERE id = $1', [req.params.memberId]);
    res.json({ message: 'Compte supprimé définitivement.' });
  } catch (err) {
    console.error('[DELETE /team/:memberId]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
