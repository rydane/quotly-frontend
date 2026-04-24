'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './data/quotly.db';
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schéma ───────────────────────────────────────────────────────────────────
db.exec(`
  -- Équipes (plan Équipe)
  CREATE TABLE IF NOT EXISTS teams (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    owner_id    TEXT NOT NULL,
    plan        TEXT NOT NULL DEFAULT 'team',
    max_users   INTEGER NOT NULL DEFAULT 5,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Utilisateurs
  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    name            TEXT NOT NULL,
    plan            TEXT NOT NULL DEFAULT 'starter',   -- starter | pro | team
    team_id         TEXT REFERENCES teams(id),
    role            TEXT NOT NULL DEFAULT 'owner',     -- owner | member
    paypal_sub_id   TEXT,
    plan_expires_at TEXT,
    quotes_this_month INTEGER NOT NULL DEFAULT 0,
    month_reset_at  TEXT NOT NULL DEFAULT (datetime('now', 'start of month', '+1 month')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Paramètres entreprise
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    company_name    TEXT,
    company_address TEXT,
    company_phone   TEXT,
    company_email   TEXT,
    siret           TEXT,
    logo_path       TEXT,
    primary_color   TEXT DEFAULT '#4f46e5',
    font            TEXT DEFAULT 'Helvetica',
    iban            TEXT,
    conditions_default TEXT DEFAULT 'Devis valable selon la durée indiquée. Acompte de 30% à la commande.'
  );

  -- Devis
  CREATE TABLE IF NOT EXISTS quotes (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id         TEXT REFERENCES teams(id),
    number          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | accepted | refused | expired
    client_name     TEXT NOT NULL,
    client_address  TEXT,
    client_email    TEXT,
    company_name    TEXT NOT NULL,
    items           TEXT NOT NULL DEFAULT '[]',     -- JSON
    tva_rate        REAL NOT NULL DEFAULT 20,
    validity_days   INTEGER NOT NULL DEFAULT 30,
    conditions      TEXT,
    template_id     TEXT DEFAULT 'classic',
    signature_token TEXT UNIQUE,
    token_expires_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at         TEXT,
    accepted_at     TEXT,
    refused_at      TEXT
  );

  -- Factures
  CREATE TABLE IF NOT EXISTS invoices (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id         TEXT REFERENCES teams(id),
    quote_id        TEXT REFERENCES quotes(id),
    number          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | paid | overdue
    client_name     TEXT NOT NULL,
    client_address  TEXT,
    client_email    TEXT,
    company_name    TEXT NOT NULL,
    items           TEXT NOT NULL DEFAULT '[]',
    tva_rate        REAL NOT NULL DEFAULT 20,
    due_days        INTEGER NOT NULL DEFAULT 30,
    conditions      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at         TEXT,
    paid_at         TEXT
  );

  -- Signatures électroniques
  CREATE TABLE IF NOT EXISTS signatures (
    id              TEXT PRIMARY KEY,
    quote_id        TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    signer_name     TEXT NOT NULL,
    signer_email    TEXT,
    signer_ip       TEXT,
    signature_data  TEXT NOT NULL,   -- base64 image du tracé
    signed_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Logs email
  CREATE TABLE IF NOT EXISTS email_logs (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    quote_id        TEXT,
    invoice_id      TEXT,
    to_email        TEXT NOT NULL,
    subject         TEXT,
    status          TEXT DEFAULT 'sent',
    error           TEXT,
    sent_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Webhooks PayPal
  CREATE TABLE IF NOT EXISTS paypal_events (
    id              TEXT PRIMARY KEY,
    event_type      TEXT NOT NULL,
    resource_id     TEXT,
    payload         TEXT,
    processed_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Index pour perf
  CREATE INDEX IF NOT EXISTS idx_quotes_user    ON quotes(user_id);
  CREATE INDEX IF NOT EXISTS idx_quotes_status  ON quotes(status);
  CREATE INDEX IF NOT EXISTS idx_invoices_user  ON invoices(user_id);
  CREATE INDEX IF NOT EXISTS idx_email_logs_user ON email_logs(user_id);
`);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Génère le prochain numéro de devis : DEV-2024-0042 */
function nextQuoteNumber(userId) {
  const year = new Date().getFullYear();
  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM quotes WHERE user_id = ? AND number LIKE ?`
  ).get(userId, `DEV-${year}-%`);
  const n = (row.cnt || 0) + 1;
  return `DEV-${year}-${String(n).padStart(4, '0')}`;
}

/** Génère le prochain numéro de facture : FAC-2024-0001 */
function nextInvoiceNumber(userId) {
  const year = new Date().getFullYear();
  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM invoices WHERE user_id = ? AND number LIKE ?`
  ).get(userId, `FAC-${year}-%`);
  const n = (row.cnt || 0) + 1;
  return `FAC-${year}-${String(n).padStart(4, '0')}`;
}

/** Réinitialise le compteur mensuel si nécessaire */
function checkMonthReset(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return;
  if (new Date() >= new Date(user.month_reset_at)) {
    db.prepare(`
      UPDATE users SET quotes_this_month = 0,
      month_reset_at = datetime('now', 'start of month', '+1 month')
      WHERE id = ?
    `).run(userId);
  }
}

module.exports = { db, nextQuoteNumber, nextInvoiceNumber, checkMonthReset };
