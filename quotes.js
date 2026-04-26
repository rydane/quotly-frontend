'use strict';
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── Helper : remplace db.prepare().run() et db.prepare().get() ─────────────
// Compatible avec le reste du code via des méthodes synchrones-like
const db = {
  pool,

  // Exécute une requête async → à utiliser dans les routes avec await
  async query(sql, params = []) {
    const client = await pool.connect();
    try {
      return await client.query(sql, params);
    } finally {
      client.release();
    }
  },

  // Retourne la première ligne ou undefined
  async get(sql, params = []) {
    const res = await this.query(sql, params);
    return res.rows[0];
  },

  // Retourne toutes les lignes
  async all(sql, params = []) {
    const res = await this.query(sql, params);
    return res.rows;
  },

  // Exécute sans retour
  async run(sql, params = []) {
    return await this.query(sql, params);
  },
};

// ─── Schéma PostgreSQL ────────────────────────────────────────────────────────
async function initSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      owner_id    TEXT NOT NULL,
      plan        TEXT NOT NULL DEFAULT 'team',
      max_users   INTEGER NOT NULL DEFAULT 5,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id                   TEXT PRIMARY KEY,
      email                TEXT UNIQUE NOT NULL,
      name                 TEXT NOT NULL,
      password_hash        TEXT NOT NULL,
      plan                 TEXT NOT NULL DEFAULT 'starter',
      role                 TEXT NOT NULL DEFAULT 'owner',
      team_id              TEXT REFERENCES teams(id) ON DELETE SET NULL,
      quotes_this_month    INTEGER NOT NULL DEFAULT 0,
      month_reset          TEXT NOT NULL DEFAULT TO_CHAR(NOW(),'YYYY-MM'),
      reset_token          TEXT,
      reset_token_expires  TIMESTAMPTZ,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id        TEXT REFERENCES teams(id) ON DELETE SET NULL,
      number         TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'draft',
      client_name    TEXT NOT NULL,
      client_address TEXT,
      client_email   TEXT,
      company_name   TEXT NOT NULL,
      items          JSONB NOT NULL DEFAULT '[]',
      tva_rate       NUMERIC NOT NULL DEFAULT 20,
      validity_days  INTEGER NOT NULL DEFAULT 30,
      conditions     TEXT,
      template_id    TEXT NOT NULL DEFAULT 'classique',
      signature_token TEXT,
      signature_data  TEXT,
      signed_at       TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id       TEXT REFERENCES teams(id) ON DELETE SET NULL,
      quote_id      TEXT REFERENCES quotes(id) ON DELETE SET NULL,
      number        TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'draft',
      client_name   TEXT NOT NULL,
      client_email  TEXT,
      company_name  TEXT NOT NULL,
      items         JSONB NOT NULL DEFAULT '[]',
      tva_rate      NUMERIC NOT NULL DEFAULT 20,
      due_days      INTEGER NOT NULL DEFAULT 30,
      conditions    TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS email_logs (
      id         TEXT PRIMARY KEY,
      user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
      quote_id   TEXT REFERENCES quotes(id) ON DELETE SET NULL,
      invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
      to_email   TEXT NOT NULL,
      subject    TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'sent',
      sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      company_name   TEXT,
      company_address TEXT,
      company_email  TEXT,
      company_phone  TEXT,
      siret          TEXT,
      logo_url       TEXT,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('✅ Schema PostgreSQL initialisé');
}

// Init au démarrage
initSchema().catch(err => {
  console.error('❌ Erreur init schema:', err.message);
  process.exit(1);
});

module.exports = { db, pool };
