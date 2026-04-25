'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db }  = require('../db/schema');
const { requireAuth, requirePlan, requireTeamOwner } = require('../middleware/auth');

const router = express.Router();

/** GET /api/team — infos équipe + membres */
router.get('/', requireAuth, requirePlan('team'), (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.user.team_id);
  if (!team) return res.status(404).json({ error: 'Aucune équipe associée.' });

  const members = db.prepare(`
    SELECT id, name, email, role, plan, created_at FROM users WHERE team_id = ?
  `).all(team.id);

  res.json({ team, members });
});

/** POST /api/team — crée une équipe (owner devient le 1er membre) */
router.post('/', requireAuth, requirePlan('team'), requireTeamOwner, (req, res) => {
  if (req.user.team_id) {
    return res.status(409).json({ error: 'Vous faites déjà partie d\'une équipe.' });
  }

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom de l\'équipe requis.' });

  const teamId = uuidv4();
  db.prepare(`INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)`).run(teamId, name, req.user.id);
  db.prepare(`UPDATE users SET team_id = ? WHERE id = ?`).run(teamId, req.user.id);

  res.status(201).json({ message: `Équipe "${name}" créée.`, team_id: teamId });
});

/** POST /api/team/invite — inviter un membre */
router.post('/invite', requireAuth, requirePlan('team'), requireTeamOwner, async (req, res) => {
  const { email, name, password } = req.body;
  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Email, nom et mot de passe requis.' });
  }

  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.user.team_id);
  if (!team) return res.status(404).json({ error: 'Équipe introuvable.' });

  // Vérifier la limite de membres
  const memberCount = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE team_id = ?').get(team.id).cnt;
  if (memberCount >= team.max_users) {
    return res.status(429).json({
      error: `Limite atteinte : ${team.max_users} membres maximum sur le plan Équipe.`,
    });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    // Si l'user existe, on l'ajoute à l'équipe
    if (existing.team_id) return res.status(409).json({ error: 'Cet utilisateur appartient déjà à une équipe.' });
    db.prepare(`UPDATE users SET team_id = ?, plan = 'team', role = 'member' WHERE id = ?`)
      .run(team.id, existing.id);
    db.prepare(`INSERT OR REPLACE INTO user_settings (user_id) VALUES (?)`).run(existing.id);
    return res.json({ message: `${email} ajouté à l'équipe.` });
  }

  // Créer un nouveau compte membre
  const hash = await bcrypt.hash(password, 12);
  const id = uuidv4();
  db.prepare(`
    INSERT INTO users (id, email, password_hash, name, plan, team_id, role)
    VALUES (?, ?, ?, ?, 'team', ?, 'member')
  `).run(id, email.toLowerCase(), hash, name, team.id);
  db.prepare(`INSERT INTO user_settings (user_id) VALUES (?)`).run(id);

  res.status(201).json({ message: `Membre ${name} (${email}) créé et ajouté à l'équipe.` });
});

/** DELETE /api/team/members/:memberId — retirer un membre */
router.delete('/members/:memberId', requireAuth, requirePlan('team'), requireTeamOwner, (req, res) => {
  const member = db.prepare('SELECT * FROM users WHERE id = ? AND team_id = ?')
    .get(req.params.memberId, req.user.team_id);
  if (!member) return res.status(404).json({ error: 'Membre introuvable.' });
  if (member.id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas vous retirer vous-même.' });

  db.prepare(`UPDATE users SET team_id = NULL, plan = 'starter', role = 'owner' WHERE id = ?`)
    .run(member.id);
  res.json({ message: `${member.name} retiré de l'équipe.` });
});

/** GET /api/team/quotes — tous les devis de l'équipe */
router.get('/quotes', requireAuth, requirePlan('team'), (req, res) => {
  const quotes = db.prepare(`
    SELECT q.*, u.name as author_name
    FROM quotes q
    JOIN users u ON u.id = q.user_id
    WHERE q.team_id = ?
    ORDER BY q.created_at DESC
    LIMIT 100
  `).all(req.user.team_id);
  res.json({ quotes });
});

module.exports = router;
