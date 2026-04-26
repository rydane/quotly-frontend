'use strict';
const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { db }   = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const nodemailer = require('nodemailer');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  });
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 chiffres
}

async function sendOTPEmail(email, name, otp) {
  const transporter = createTransport();
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || `Quotly <${process.env.GMAIL_USER}>`,
    to: email,
    subject: `🔐 Votre code de connexion Quotly : ${otp}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
        <div style="background:#166534;padding:28px 32px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:24px">Quotly</h1>
        </div>
        <div style="padding:32px">
          <h2 style="margin:0 0 12px;color:#111">Bonjour ${name} 👋</h2>
          <p style="color:#555;line-height:1.7">Voici votre code de connexion à usage unique. Il est valable <strong>10 minutes</strong>.</p>
          <div style="text-align:center;margin:28px 0">
            <div style="display:inline-block;background:#f0fdf4;border:2px solid #16a34a;border-radius:12px;padding:20px 40px">
              <span style="font-size:36px;font-weight:800;color:#166534;letter-spacing:8px">${otp}</span>
            </div>
          </div>
          <p style="color:#999;font-size:13px">Si vous n'avez pas tenté de vous connecter, ignorez cet email.</p>
        </div>
        <div style="background:#f9f9f9;padding:16px 32px;text-align:center;border-top:1px solid #eee">
          <p style="color:#aaa;font-size:12px;margin:0">© 2025 Quotly</p>
        </div>
      </div>
    `,
  });
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Nom, email et mot de passe requis.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Mot de passe trop court (min. 6 caractères).' });

    const existing = await db.get('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé.' });

    const hash = await bcrypt.hash(password, 12);
    const id   = uuidv4();
    await db.run(
      'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
      [id, email.toLowerCase().trim(), name.trim(), hash]
    );

    const user = await db.get('SELECT id, email, name, plan, role, team_id FROM users WHERE id = $1', [id]);
    const token = jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.status(201).json({ token, user });
  } catch (err) {
    console.error('register:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
// Étape 1 : vérifie email+password, envoie OTP par email
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email et mot de passe requis.' });

    const user = await db.get('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });

    // Générer OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

    await db.run(
      'UPDATE users SET otp_code = $1, otp_expires = $2 WHERE id = $3',
      [otp, otpExpires, user.id]
    );

    // Envoyer OTP par email
    try {
      await sendOTPEmail(user.email, user.name, otp);
    } catch (mailErr) {
      console.error('OTP email error:', mailErr.message);
      // En dev, si pas de config email, on log le code
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[DEV] OTP pour ${user.email}: ${otp}`);
      }
    }

    // Retourner succès partiel — le frontend affichera le champ OTP
    res.json({ 
      require_otp: true, 
      email: user.email,
      message: `Code envoyé à ${user.email}` 
    });
  } catch (err) {
    console.error('login:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── POST /api/auth/verify-otp ────────────────────────────────────────────────
// Étape 2 : vérifie le code OTP et retourne le JWT
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp)
      return res.status(400).json({ error: 'Email et code requis.' });

    const user = await db.get('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!user) return res.status(401).json({ error: 'Utilisateur introuvable.' });

    if (!user.otp_code || !user.otp_expires)
      return res.status(400).json({ error: 'Aucun code en attente. Reconnectez-vous.' });

    if (new Date(user.otp_expires) < new Date())
      return res.status(400).json({ error: 'Code expiré. Reconnectez-vous pour recevoir un nouveau code.' });

    if (user.otp_code !== otp.trim())
      return res.status(401).json({ error: 'Code incorrect.' });

    // Invalider l'OTP
    await db.run('UPDATE users SET otp_code = NULL, otp_expires = NULL WHERE id = $1', [user.id]);

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.json({ 
      token, 
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan, team_id: user.team_id, role: user.role } 
    });
  } catch (err) {
    console.error('verify-otp:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await db.get('SELECT id, email, name, plan, role, team_id, quotes_this_month FROM users WHERE id = $1', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── PUT /api/auth/password ───────────────────────────────────────────────────
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: 'Champs manquants.' });
    if (newPassword.length < 6)
      return res.status(400).json({ error: 'Nouveau mot de passe trop court.' });

    const user = await db.get('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });

    const hash = await bcrypt.hash(newPassword, 12);
    await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ message: 'Mot de passe mis à jour.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis.' });

    const user = await db.get('SELECT id, name FROM users WHERE email = $1', [email.toLowerCase().trim()]);

    // ✅ CORRECTION : si le compte n'existe pas, on dit clairement
    if (!user) return res.status(404).json({ error: 'Aucun compte trouvé avec cet email.' });

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600 * 1000).toISOString();

    await db.run(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [token, expires, user.id]
    );

    const frontendUrl = process.env.FRONTEND_URL || 'https://quotly-frontend.vercel.app';
    const resetLink = `${frontendUrl}?reset_token=${token}&email=${encodeURIComponent(email.toLowerCase())}`;

    try {
      const transporter = createTransport();
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || `Quotly <${process.env.GMAIL_USER}>`,
        to: email,
        subject: '🔑 Réinitialisation de votre mot de passe Quotly',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
            <div style="background:#166534;padding:28px 32px;text-align:center">
              <h1 style="color:#fff;margin:0;font-size:24px">Quotly</h1>
            </div>
            <div style="padding:32px">
              <h2 style="margin:0 0 12px;color:#111">Bonjour ${user.name} 👋</h2>
              <p style="color:#555;line-height:1.7">Cliquez sur le bouton ci-dessous — ce lien est valable <strong>1 heure</strong>.</p>
              <div style="text-align:center;margin:28px 0">
                <a href="${resetLink}" style="background:#166534;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block">
                  🔒 Réinitialiser mon mot de passe
                </a>
              </div>
              <p style="color:#999;font-size:13px">Si vous n'avez pas fait cette demande, ignorez cet email.</p>
            </div>
            <div style="background:#f9f9f9;padding:16px 32px;text-align:center;border-top:1px solid #eee">
              <p style="color:#aaa;font-size:12px;margin:0">© 2025 Quotly</p>
            </div>
          </div>
        `,
      });
    } catch(mailErr) {
      console.error('Email reset error:', mailErr.message);
    }

    res.json({ message: 'Email de réinitialisation envoyé.' });
  } catch (err) {
    console.error('forgot-password:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { email, token, password } = req.body;
    if (!email || !token || !password)
      return res.status(400).json({ error: 'Données manquantes.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Mot de passe trop court (min. 6 caractères).' });

    const user = await db.get(
      'SELECT id, reset_token, reset_token_expires FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (!user || !user.reset_token)
      return res.status(400).json({ error: 'Lien invalide ou expiré. Refaites une demande.' });
    if (user.reset_token !== token)
      return res.status(400).json({ error: 'Lien invalide. Refaites une demande.' });
    if (new Date(user.reset_token_expires) < new Date())
      return res.status(400).json({ error: 'Lien expiré (valable 1h). Refaites une demande.' });

    const hash = await bcrypt.hash(password, 12);
    await db.run(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [hash, user.id]
    );

    res.json({ message: 'Mot de passe réinitialisé avec succès. Vous pouvez vous connecter.' });
  } catch (err) {
    console.error('reset-password:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── DELETE /api/auth/account ─────────────────────────────────────────────────
router.delete('/account', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    const user = await db.get('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect.' });
    await db.run('DELETE FROM users WHERE id = $1', [req.user.id]);
    res.json({ message: 'Compte supprimé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
