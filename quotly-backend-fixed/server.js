'use strict';
require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
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
const relancesRoutes  = require('./routes/relances');
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

// ─── Body parsers ─────────────────────────────────────────────────────────────
// Note: /api/webhooks/paypal utilise express.raw(), monté avant json()
app.use('/api/webhooks', webhooksRoutes);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',       authLimiter, authRoutes);
app.use('/api/quotes',     quotesRoutes);
app.use('/api/quotes',     relancesRoutes);
// Endpoint cron accessible en /api/relances/cron
app.use('/api',            relancesRoutes);
app.use('/api/invoices',   invoicesRoutes);
app.use('/api/sign',       signaturesRoutes);
app.use('/api/stats',      statsRoutes);
app.use('/api/settings',   settingsRoutes);
app.use('/api/team',       teamRoutes);
app.use('/api',            teamMembersRoutes);
initTeamTable();

// ─── Statique (logos publics) ─────────────────────────────────────────────────
app.use('/uploads', express.static(path.resolve(process.env.UPLOAD_DIR || './uploads')));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Quotly Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── API docs rapides ─────────────────────────────────────────────────────────
app.get('/api', (req, res) => {
  res.json({
    service: 'Quotly API v1',
    endpoints: {
      auth:      ['POST /api/auth/register', 'POST /api/auth/login', 'GET /api/auth/me', 'PUT /api/auth/password', 'DELETE /api/auth/account'],
      quotes:    ['GET /api/quotes', 'POST /api/quotes', 'GET /api/quotes/:id', 'PUT /api/quotes/:id', 'DELETE /api/quotes/:id', 'GET /api/quotes/:id/pdf', 'POST /api/quotes/:id/send', 'POST /api/quotes/:id/duplicate'],
      invoices:  ['GET /api/invoices', 'POST /api/invoices', 'POST /api/invoices/from-quote/:id', 'GET /api/invoices/:id', 'PUT /api/invoices/:id', 'DELETE /api/invoices/:id', 'GET /api/invoices/:id/pdf', 'POST /api/invoices/:id/send'],
      sign:      ['GET /api/sign/:token', 'POST /api/sign/:token', 'GET /api/sign/status/:quoteId'],
      stats:     ['GET /api/stats', 'GET /api/stats/email-logs'],
      settings:  ['GET /api/settings', 'PUT /api/settings', 'POST /api/settings/logo', 'DELETE /api/settings/logo', 'GET /api/settings/templates'],
      team:      ['GET /api/team', 'POST /api/team', 'POST /api/team/invite', 'DELETE /api/team/members/:id', 'GET /api/team/quotes'],
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
