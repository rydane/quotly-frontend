'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { db }  = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { sendWelcomeEmail } = require('../services/email');

const router = express.Router();

/** POST /api/auth/register */
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Tous les champs sont requis.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Email invalide.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const id = uuidv4();

    db.prepare(`
      INSERT INTO users (id, email, password_hash, name, plan)
      VALUES (?, ?, ?, ?, 'starter')
    `).run(id, email.toLowerCase(), password_hash, name.trim());

    // Paramètres entreprise vides
    db.prepare(`INSERT INTO user_settings (user_id) VALUES (?)`).run(id);

    // Email de bienvenue (non-bloquant)
    sendWelcomeEmail({ to: email, name }).catch(console.error);

    const token = jwt.sign({ id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    res.status(201).json({
      message: 'Compte créé avec succès.',
      token,
      user: { id, email: email.toLowerCase(), name, plan: 'starter' },
    });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/** POST /api/auth/login */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        team_id: user.team_id,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/** GET /api/auth/me */
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, name, plan, team_id, role, quotes_this_month, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id);
  res.json({ user, settings });
});

/** PUT /api/auth/password */
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Les deux mots de passe sont requis.' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 8 caractères.' });
    }

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
    res.json({ message: 'Mot de passe mis à jour.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/** DELETE /api/auth/account */
router.delete('/account', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Mot de passe incorrect.' });
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    res.json({ message: 'Compte supprimé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});


/** POST /api/auth/forgot-password — vérifie que le compte existe */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis.' });
    const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?')
      .get(email.toLowerCase().trim());
    if (!user) return res.status(404).json({ error: 'Aucun compte trouvé avec cet email.' });
    res.json({ message: 'Compte trouvé.', name: user.name });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/** POST /api/auth/reset-password — réinitialise le mot de passe */
router.post('/reset-password', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min. 6 caractères).' });
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) return res.status(404).json({ error: 'Compte introuvable.' });
    const hash = await bcrypt.hash(password, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    res.json({ message: 'Mot de passe réinitialisé avec succès.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});
module.exports = router;
