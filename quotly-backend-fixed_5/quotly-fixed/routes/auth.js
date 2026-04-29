'use strict';
const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { db }   = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const nodemailer = require('nodemailer');

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  });
}
function generateCode() { return Math.floor(100000 + Math.random() * 900000).toString(); }

async function sendCodeEmail(email, name, code, subject, msg) {
  const t = createTransport();
  await t.sendMail({
    from: process.env.EMAIL_FROM || `Quotly <${process.env.GMAIL_USER}>`,
    to: email, subject,
    // ✅ FIX #2 : Template renommé "Quotly" (était "DEFACT", ancien nom du projet)
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
      <div style="background:#0e0d0b;padding:24px 32px;text-align:center"><h1 style="color:#c9a84c;margin:0;letter-spacing:.15em">QUOTLY</h1></div>
      <div style="padding:32px">
        <p style="color:#555;line-height:1.7">Bonjour ${name},<br>${msg}</p>
        <div style="text-align:center;margin:28px 0">
          <div style="display:inline-block;background:#fdf8ed;border:2px solid #c9a84c;border-radius:12px;padding:20px 40px">
            <span style="font-size:36px;font-weight:800;color:#0e0d0b;letter-spacing:8px">${code}</span>
          </div>
        </div>
        <p style="color:#999;font-size:13px">Si vous n'avez pas fait cette demande, ignorez cet email.</p>
      </div>
      <div style="background:#f9f9f9;padding:16px;text-align:center;border-top:1px solid #eee"><p style="color:#aaa;font-size:12px;margin:0">© 2025 Quotly</p></div>
    </div>`,
  });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Nom, email et mot de passe requis.' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min. 6 caractères).' });
    const existing = await db.get('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    // ✅ FIX #3 : bcrypt réduit à 10 rounds (était 12 → causait 5-8s de latence en serverless)
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await db.run('INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)', [id, email.toLowerCase().trim(), name.trim(), hash]);
    const user = await db.get('SELECT id, email, name, plan, role, team_id FROM users WHERE id = $1', [id]);
    const token = jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.status(201).json({ token, user });
  } catch (err) { console.error('register:', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

// POST /api/auth/login — envoie OTP
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });
    const user = await db.get('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    const otp = generateCode();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await db.run('UPDATE users SET otp_code = $1, otp_expires = $2 WHERE id = $3', [otp, otpExpires, user.id]);
    // ✅ FIX #1 : L'erreur d'envoi d'email est maintenant remontée au frontend
    // (avant : l'erreur était avalée et le frontend affichait "vérifiez votre email" même si rien n'était envoyé)
    try {
      await sendCodeEmail(user.email, user.name, otp, `🔐 Code de connexion Quotly : ${otp}`, 'Voici votre code de connexion, valable <strong>10 minutes</strong>.');
    } catch (e) {
      console.error('OTP email FAILED:', e.message);
      if (process.env.NODE_ENV !== 'production') console.log(`[DEV] OTP ${user.email}: ${otp}`);
      return res.status(500).json({ error: "Impossible d'envoyer le code de vérification. Vérifiez votre adresse email ou réessayez." });
    }
    res.json({ require_otp: true, email: user.email });
  } catch (err) { console.error('login:', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email et code requis.' });
    const user = await db.get('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!user) return res.status(401).json({ error: 'Utilisateur introuvable.' });
    if (!user.otp_code || !user.otp_expires) return res.status(400).json({ error: 'Aucun code en attente.' });
    if (new Date(user.otp_expires) < new Date()) return res.status(400).json({ error: 'Code expiré.' });
    if (user.otp_code !== otp.trim()) return res.status(401).json({ error: 'Code incorrect.' });
    await db.run('UPDATE users SET otp_code = NULL, otp_expires = NULL WHERE id = $1', [user.id]);
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, team_id: user.team_id, role: user.role } });
  } catch (err) { console.error('verify-otp:', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await db.get('SELECT id, email, name, plan, role, team_id, quotes_this_month FROM users WHERE id = $1', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.json({ user });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

// PUT /api/auth/password
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Champs manquants.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Nouveau mot de passe trop court.' });
    const user = await db.get('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
    // ✅ FIX #3 : bcrypt réduit à 10 rounds ici aussi
    const hash = await bcrypt.hash(newPassword, 10);
    await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ message: 'Mot de passe mis à jour.' });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

// POST /api/auth/forgot-password — envoie code 6 chiffres (pas de lien)
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis.' });
    const user = await db.get('SELECT id, name FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (!user) return res.status(404).json({ error: 'Aucun compte trouvé avec cet email.' });
    const code = generateCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await db.run('UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3', [code, expires, user.id]);
    // ✅ FIX #1 : Même correction ici — l'erreur d'email est remontée au frontend
    try {
      await sendCodeEmail(email.toLowerCase(), user.name, code, `🔑 Code de réinitialisation Quotly : ${code}`, 'Voici votre code de réinitialisation, valable <strong>15 minutes</strong>.');
    } catch (e) {
      console.error('Reset email FAILED:', e.message);
      if (process.env.NODE_ENV !== 'production') console.log(`[DEV] Reset code ${email}: ${code}`);
      return res.status(500).json({ error: "Impossible d'envoyer l'email de réinitialisation. Réessayez." });
    }
    res.json({ message: 'Code envoyé par email.' });
  } catch (err) { console.error('forgot-password:', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

// POST /api/auth/reset-password — avec code 6 chiffres
router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, password } = req.body;
    if (!email || !code || !password) return res.status(400).json({ error: 'Données manquantes.' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court.' });
    const user = await db.get('SELECT id, reset_token, reset_token_expires FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (!user || !user.reset_token) return res.status(400).json({ error: 'Code invalide. Refaites une demande.' });
    if (user.reset_token !== code.trim()) return res.status(400).json({ error: 'Code incorrect.' });
    if (new Date(user.reset_token_expires) < new Date()) return res.status(400).json({ error: 'Code expiré. Refaites une demande.' });
    // ✅ FIX #3 : bcrypt réduit à 10 rounds ici aussi
    const hash = await bcrypt.hash(password, 10);
    await db.run('UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2', [hash, user.id]);
    res.json({ message: 'Mot de passe réinitialisé. Connectez-vous.' });
  } catch (err) { console.error('reset-password:', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

// DELETE /api/auth/account
router.delete('/account', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    const user = await db.get('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect.' });
    await db.run('DELETE FROM users WHERE id = $1', [req.user.id]);
    res.json({ message: 'Compte supprimé.' });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

module.exports = router;
