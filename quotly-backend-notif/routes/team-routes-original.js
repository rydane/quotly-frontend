// ============================================================
// ROUTES ÉQUIPE — À AJOUTER DANS TON BACKEND
// Fichier : team-routes.js (place-le dans /routes/ ou /src/)
// ============================================================
//
// INTÉGRATION (dans ton fichier principal app.js / index.js / server.js) :
//   const teamRoutes = require('./team-routes');
//   app.use('/api', teamRoutes);
//
// PRÉREQUIS : tu dois avoir ces fonctions disponibles dans ton projet :
//   - authenticateToken(req, res, next)  → middleware JWT existant
//   - db                                  → ta connexion base de données
// ============================================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

// ⚠️  Adapte ces imports à TON projet :
// Si tu utilises CommonJS :
//   const { authenticateToken, db } = require('../middleware/auth'); // adapte le chemin
// Si tu exportes depuis un fichier dédié :
//   const authenticateToken = require('../middleware/authenticate');
//   const db = require('../database');

// ─────────────────────────────────────────────────────────────
// INITIALISATION — crée la table si elle n'existe pas (SQLite)
// Si tu utilises PostgreSQL/MySQL, adapte la syntaxe SQL
// ─────────────────────────────────────────────────────────────
function initTeamTable(db) {
  // SQLite
  db.run(`
    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  // PostgreSQL : remplace INTEGER PRIMARY KEY AUTOINCREMENT par SERIAL PRIMARY KEY
  // MySQL : identique à PostgreSQL pour l'auto-increment
}

// Appelle cette fonction au démarrage du serveur :
// initTeamTable(db);

// ─────────────────────────────────────────────────────────────
// GET /api/team/members — Liste les membres de l'équipe
// ─────────────────────────────────────────────────────────────
router.get('/team/members', authenticateToken, (req, res) => {
  // Vérifie que l'utilisateur a le plan Équipe
  if (req.user.plan !== 'team') {
    return res.status(403).json({ error: 'Accès réservé au plan Équipe' });
  }

  // SQLite (callback style) :
  db.all(
    'SELECT id, name, email, created_at FROM team_members WHERE owner_id = ? ORDER BY created_at ASC',
    [req.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Erreur serveur' });
      res.json({ members: rows || [] });
    }
  );

  // Si tu utilises async/await avec pg ou mysql2, remplace par :
  // const result = await db.query('SELECT id, name, email, created_at FROM team_members WHERE owner_id = $1 ORDER BY created_at ASC', [req.user.id]);
  // res.json({ members: result.rows });
});

// ─────────────────────────────────────────────────────────────
// POST /api/team/members — Crée un nouveau membre
// Body: { name, email, password }
// ─────────────────────────────────────────────────────────────
router.post('/team/members', authenticateToken, async (req, res) => {
  if (req.user.plan !== 'team') {
    return res.status(403).json({ error: 'Accès réservé au plan Équipe' });
  }

  const { name, email, password } = req.body;

  if (!name || !email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Nom, email et mot de passe (min. 6 car.) requis' });
  }

  // Vérifie la limite de 5 membres
  db.get(
    'SELECT COUNT(*) as count FROM team_members WHERE owner_id = ?',
    [req.user.id],
    async (err, row) => {
      if (err) return res.status(500).json({ error: 'Erreur serveur' });
      if (row.count >= 5) {
        return res.status(400).json({ error: 'Limite de 5 comptes atteinte' });
      }

      try {
        const hash = await bcrypt.hash(password, 10);

        db.run(
          'INSERT INTO team_members (owner_id, name, email, password_hash) VALUES (?, ?, ?, ?)',
          [req.user.id, name.trim(), email.toLowerCase().trim(), hash],
          function (err2) {
            if (err2) {
              if (err2.message.includes('UNIQUE')) {
                return res.status(400).json({ error: 'Cet email est déjà utilisé' });
              }
              return res.status(500).json({ error: 'Erreur serveur' });
            }
            res.status(201).json({
              member: {
                id: this.lastID,
                name: name.trim(),
                email: email.toLowerCase().trim(),
                created_at: new Date().toISOString(),
              }
            });
          }
        );
      } catch (e) {
        res.status(500).json({ error: 'Erreur serveur' });
      }
    }
  );
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/team/members/:id — Supprime un membre
// ─────────────────────────────────────────────────────────────
router.delete('/team/members/:id', authenticateToken, (req, res) => {
  if (req.user.plan !== 'team') {
    return res.status(403).json({ error: 'Accès réservé au plan Équipe' });
  }

  const memberId = parseInt(req.params.id);

  db.run(
    'DELETE FROM team_members WHERE id = ? AND owner_id = ?',
    [memberId, req.user.id],
    function (err) {
      if (err) return res.status(500).json({ error: 'Erreur serveur' });
      if (this.changes === 0) return res.status(404).json({ error: 'Membre introuvable' });
      res.json({ success: true });
    }
  );
});

module.exports = router;
