'use strict';
require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const compression  = require('compression');
const rateLimit    = require('express-rate-limit');
const path         = require('path');

// Init DB (crée le fichier + schéma au premier démarrage)
require('./db/schema');
const { db } = require('./db/schema');

const authRoutes      = require('./routes/auth');
const quotesRoutes    = require('./routes/quotes');
const invoicesRoutes  = require('./routes/invoices');
const signaturesRoutes= require('./routes/signatures');
const statsRoutes     = require('./routes/stats');
const settingsRoutes  = require('./routes/settings');
const teamRoutes      = require('./routes/team');
const { router: teamMembersRoutes, initTeamTable } = require('./routes/team-routes');
const webhooksRoutes  = require('./routes/webhooks');
const { router: relancesRoutes, cronRouter: relancesCronRouter } = require('./routes/relances');
const { router: notificationsRoutes } = require('./routes/notifications');
const clientsRoutes   = require('./routes/clients');
const supportRoutes   = require('./routes/support');
const { startRelanceScheduler } = require('./services/relanceScheduler');

const app  = express();
const PORT = parseInt(process.env.PORT || '3001');
const FRONTEND = process.env.FRONTEND_URL || 'https://quotly-frontend.vercel.app';

// ─── Sécurité ─────────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: (origin, callback) => {
    // Accepter toutes les origines Vercel + localhost
    const allowed = [
      FRONTEND,
      'http://localhost:3000',
      'http://localhost:5173',
    ];
    if (!origin) return callback(null, true); // Postman / curl
    if (allowed.includes(origin)) return callback(null, true);
    if (origin.endsWith('.vercel.app')) return callback(null, true); // preview deployments
    callback(new Error(`CORS bloqué pour : ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400, // Cache CORS preflight 24h → élimine les requêtes OPTIONS répétées
}));

// ─── Compression gzip/brotli — réduit 70-80% la taille des réponses JSON ─────
app.use(compression({
  level: 6,             // bon compromis vitesse/taille
  threshold: 512,       // ne compresse que si > 512 bytes
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Réessayez dans 15 minutes.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
});

app.use(globalLimiter);

// ─── Cache headers — accélère les GET répétés côté navigateur ─────────────────
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') {
    // Données privées (auth requise), cachées 30s côté navigateur
    // stale-while-revalidate : sert le cache pendant qu'il revalide en background
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  } else {
    res.set('Cache-Control', 'no-store');
  }
  next();
});

// ─── Body parsers ─────────────────────────────────────────────────────────────
// Note: /api/webhooks/paypal utilise express.raw(), monté avant json()
app.use('/api/webhooks', webhooksRoutes);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',       authLimiter, authRoutes);
app.use('/api/quotes',     quotesRoutes);
app.use('/api/quotes',     relancesRoutes);
// ⚠️  Le router relances est aussi monté sous /api pour exposer /api/relances/cron
// On utilise un router dédié pour la route cron afin d'éviter tout conflit
app.use('/api',            relancesCronRouter);
app.use('/api/invoices',   invoicesRoutes);
app.use('/api/sign',       signaturesRoutes);
app.use('/api/stats',      statsRoutes);
app.use('/api/settings',   settingsRoutes);
app.use('/api/team',       teamRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/clients',    clientsRoutes);
app.use('/api/support',    supportRoutes);
app.use('/api',            teamMembersRoutes);
initTeamTable();

// ─── Statique (logos publics) ─────────────────────────────────────────────────
app.use('/uploads', express.static(path.resolve(process.env.UPLOAD_DIR || './uploads'), {
  maxAge: '7d',         // logos cachés 7 jours
  etag: true,
  lastModified: true,
  immutable: false,
}));

// ─── Health check (rapide, pas de JSON.stringify inutile) ─────────────────────
app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json({ status: 'ok', ts: Date.now() });
});

// ─── Warmup — endpoint ultra-léger pour réveiller le serveur Render ───────────
// Le frontend l'appelle dès le chargement pour réduire le cold start
app.get('/api/warmup', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(204).end();
});

// ─── API docs rapides ─────────────────────────────────────────────────────────
app.get('/api', (req, res) => {
  res.json({
    service: 'Quotly API v1',
    endpoints: {
      auth:      ['POST /api/auth/register', 'POST /api/auth/login', 'GET /api/auth/me', 'PUT /api/auth/password', 'POST /api/auth/admin-switch-plan', 'DELETE /api/auth/account'],
      quotes:    ['GET /api/quotes', 'POST /api/quotes', 'GET /api/quotes/:id', 'PUT /api/quotes/:id', 'DELETE /api/quotes/:id', 'GET /api/quotes/:id/pdf', 'POST /api/quotes/:id/send', 'POST /api/quotes/:id/duplicate'],
      invoices:  ['GET /api/invoices', 'POST /api/invoices', 'POST /api/invoices/from-quote/:id', 'GET /api/invoices/:id', 'PUT /api/invoices/:id', 'DELETE /api/invoices/:id', 'GET /api/invoices/:id/pdf', 'POST /api/invoices/:id/send'],
      sign:      ['GET /api/sign/:token', 'POST /api/sign/:token', 'POST /api/sign/:token/refuse', 'GET /api/sign/status/:quoteId'],
      stats:     ['GET /api/stats', 'GET /api/stats/email-logs'],
      settings:  ['GET /api/settings', 'PUT /api/settings', 'POST /api/settings/logo', 'DELETE /api/settings/logo', 'GET /api/settings/templates'],
      team:      ['GET /api/team', 'POST /api/team', 'POST /api/team/invite', 'DELETE /api/team/members/:id', 'GET /api/team/quotes'],
      notifications: ['GET /api/notifications', 'GET /api/notifications/unread-count', 'PUT /api/notifications/:id/read', 'PUT /api/notifications/read-all', 'DELETE /api/notifications/:id', 'DELETE /api/notifications'],
      clients:   ['GET /api/clients', 'POST /api/clients', 'GET /api/clients/:id', 'PUT /api/clients/:id', 'DELETE /api/clients/:id', 'GET /api/clients/:id/history'],
      support:   ['POST /api/support/message', 'GET /api/support/messages', 'GET /api/support/messages/unread-count', 'PUT /api/support/messages/:id/read', 'POST /api/support/messages/:id/reply', 'DELETE /api/support/messages/:id'],
      webhooks:  ['POST /api/webhooks/paypal'],
    },
  });
});

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} introuvable.` });
});

// ─── Erreurs globales ─────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  if (err.message?.includes('CORS')) return res.status(403).json({ error: err.message });
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║         🚀  Quotly Backend démarré          ║
╠══════════════════════════════════════════════╣
║  Port   : ${PORT}                              ║
║  Env    : ${(process.env.NODE_ENV || 'development').padEnd(10)}                    ║
║  DB     : ${(process.env.DB_PATH || './data/quotly.db').padEnd(10)}         ║
║  API    : http://localhost:${PORT}/api          ║
║  Health : http://localhost:${PORT}/health       ║
╚══════════════════════════════════════════════╝
  `);

  // Démarrage du scheduler de relances automatiques
  startRelanceScheduler();
});

module.exports = app;
