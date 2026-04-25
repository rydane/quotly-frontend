'use strict';
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { db }  = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads', 'logos');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${req.user.id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '5') * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Format non supporté. Utilisez JPG, PNG, WEBP ou SVG.'));
  },
});

/** GET /api/settings */
router.get('/', requireAuth, (req, res) => {
  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id);
  if (!settings) return res.json({});
  // Ne pas exposer le chemin interne du logo
  const { logo_path, ...rest } = settings;
  res.json({ settings: { ...rest, has_logo: !!logo_path } });
});

/** PUT /api/settings */
router.put('/', requireAuth, (req, res) => {
  const {
    company_name, company_address, company_phone, company_email,
    siret, primary_color, font, iban, conditions_default,
  } = req.body;

  db.prepare(`
    UPDATE user_settings SET
      company_name       = COALESCE(?, company_name),
      company_address    = COALESCE(?, company_address),
      company_phone      = COALESCE(?, company_phone),
      company_email      = COALESCE(?, company_email),
      siret              = COALESCE(?, siret),
      primary_color      = COALESCE(?, primary_color),
      font               = COALESCE(?, font),
      iban               = COALESCE(?, iban),
      conditions_default = COALESCE(?, conditions_default)
    WHERE user_id = ?
  `).run(
    company_name || null, company_address || null, company_phone || null,
    company_email || null, siret || null, primary_color || null,
    font || null, iban || null, conditions_default || null,
    req.user.id
  );

  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id);
  const { logo_path, ...rest } = settings;
  res.json({ settings: { ...rest, has_logo: !!logo_path }, message: 'Paramètres sauvegardés.' });
});

/** POST /api/settings/logo  (Pro+) */
router.post('/logo', requireAuth, (req, res) => {
  if (!['pro', 'team'].includes(req.user.plan)) {
    return res.status(403).json({
      error: 'L\'upload de logo est réservé aux plans Pro et Équipe.',
      upgrade_url: 'https://quotly-devis.netlify.app/#pricing',
    });
  }

  upload.single('logo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

    db.prepare('UPDATE user_settings SET logo_path = ? WHERE user_id = ?')
      .run(req.file.path, req.user.id);

    res.json({ message: 'Logo uploadé avec succès.', has_logo: true });
  });
});

/** DELETE /api/settings/logo */
router.delete('/logo', requireAuth, (req, res) => {
  const settings = db.prepare('SELECT logo_path FROM user_settings WHERE user_id = ?').get(req.user.id);
  if (settings?.logo_path && fs.existsSync(settings.logo_path)) {
    fs.unlinkSync(settings.logo_path);
  }
  db.prepare('UPDATE user_settings SET logo_path = NULL WHERE user_id = ?').run(req.user.id);
  res.json({ message: 'Logo supprimé.' });
});

/** GET /api/settings/logo  (affichage logo) */
router.get('/logo', requireAuth, (req, res) => {
  const settings = db.prepare('SELECT logo_path FROM user_settings WHERE user_id = ?').get(req.user.id);
  if (!settings?.logo_path || !fs.existsSync(settings.logo_path)) {
    return res.status(404).json({ error: 'Aucun logo.' });
  }
  res.sendFile(path.resolve(settings.logo_path));
});

/** Liste des templates disponibles */
router.get('/templates', requireAuth, (req, res) => {
  const all = [
    { id: 'classic',    name: 'Classique',       plan: 'starter', preview: '#4f46e5' },
    { id: 'modern',     name: 'Moderne',          plan: 'pro',     preview: '#0ea5e9' },
    { id: 'minimal',    name: 'Minimaliste',      plan: 'pro',     preview: '#374151' },
    { id: 'bold',       name: 'Audacieux',        plan: 'pro',     preview: '#dc2626' },
    { id: 'green',      name: 'Éco',              plan: 'pro',     preview: '#16a34a' },
    { id: 'orange',     name: 'Chaleureux',       plan: 'pro',     preview: '#ea580c' },
    { id: 'dark',       name: 'Sombre',           plan: 'pro',     preview: '#1e293b' },
    { id: 'rose',       name: 'Rose',             plan: 'pro',     preview: '#e11d48' },
    { id: 'artisan',    name: 'Artisan',          plan: 'pro',     preview: '#92400e' },
    { id: 'batiment',   name: 'Bâtiment',         plan: 'pro',     preview: '#1d4ed8' },
    { id: 'it',         name: 'Tech / IT',        plan: 'pro',     preview: '#7c3aed' },
    { id: 'sante',      name: 'Santé / Bien-être',plan: 'pro',     preview: '#0891b2' },
    { id: 'juridique',  name: 'Juridique',        plan: 'pro',     preview: '#1e3a5f' },
    { id: 'immobilier', name: 'Immobilier',       plan: 'pro',     preview: '#b45309' },
    { id: 'creative',   name: 'Créatif',          plan: 'pro',     preview: '#9333ea' },
    { id: 'finance',    name: 'Finance',          plan: 'pro',     preview: '#0f766e' },
    { id: 'restaurant', name: 'Restauration',     plan: 'pro',     preview: '#b91c1c' },
    { id: 'transport',  name: 'Transport',        plan: 'pro',     preview: '#475569' },
    { id: 'education',  name: 'Éducation',        plan: 'pro',     preview: '#2563eb' },
    { id: 'elegant',    name: 'Élégant',          plan: 'pro',     preview: '#713f12' },
  ];

  const userPlan = req.user.plan;
  const templates = all.map(t => ({
    ...t,
    locked: t.plan === 'pro' && userPlan === 'starter',
  }));

  res.json({ templates });
});

module.exports = router;
