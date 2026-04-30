'use strict';
const { Pool } = require('pg');
require('dotenv').config();

// ✅ FIX #4 : Pool limité à 1 connexion max pour Vercel serverless
// (avant : pool sans limite → accumulation de connexions au fil des cold starts → timeouts)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : false,
});

const db = {
  pool,
  async query(sql, params = []) {
    const client = await pool.connect();
    try { return await client.query(sql, params); }
    finally { client.release(); }
  },
  async get(sql, params = []) {
    const res = await this.query(sql, params);
    return res.rows[0];
  },
  async all(sql, params = []) {
    const res = await this.query(sql, params);
    return res.rows;
  },
  async run(sql, params = []) {
    return await this.query(sql, params);
  },
};

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
      team_id              TEXT,
      quotes_this_month    INTEGER NOT NULL DEFAULT 0,
      month_reset          TEXT NOT NULL DEFAULT TO_CHAR(NOW(),'YYYY-MM'),
      reset_token          TEXT,
      reset_token_expires  TIMESTAMPTZ,
      otp_code             TEXT,
      otp_expires          TIMESTAMPTZ,
      signatures_count     INTEGER NOT NULL DEFAULT 0,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id         TEXT,
      number          TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'draft',
      client_name     TEXT NOT NULL,
      client_address  TEXT,
      client_email    TEXT,
      company_name    TEXT NOT NULL,
      items           JSONB NOT NULL DEFAULT '[]',
      tva_rate        NUMERIC NOT NULL DEFAULT 20,
      validity_days   INTEGER NOT NULL DEFAULT 30,
      conditions      TEXT,
      template_id     TEXT NOT NULL DEFAULT 'classique',
      signature_token TEXT,
      signature_data  TEXT,
      signer_name     TEXT,
      signed_at       TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id       TEXT,
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
      user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      company_name    TEXT,
      company_address TEXT,
      company_email   TEXT,
      company_phone   TEXT,
      siret           TEXT,
      logo_url        TEXT,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS relances (
      id             TEXT PRIMARY KEY,
      quote_id       TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_email   TEXT NOT NULL,
      active         BOOLEAN NOT NULL DEFAULT TRUE,
      interval_hours INTEGER NOT NULL DEFAULT 24,
      max_count      INTEGER NOT NULL DEFAULT 5,
      sent_count     INTEGER NOT NULL DEFAULT 0,
      next_send_at   TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS relance_logs (
      id         TEXT PRIMARY KEY,
      relance_id TEXT NOT NULL REFERENCES relances(id) ON DELETE CASCADE,
      quote_id   TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      to_email   TEXT NOT NULL,
      attempt    INTEGER NOT NULL,
      status     TEXT NOT NULL DEFAULT 'sent',
      sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id            TEXT PRIMARY KEY,
      owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── Migrations colonnes ────────────────────────────────────────────────────
  const safeAlter = async (table, col, type) => {
    try {
      await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    } catch (err) {
      if (!err.message.includes('already exists'))
        console.warn(`[migration] ${table}.${col}: ${err.message}`);
    }
  };

  await safeAlter('users', 'otp_code', 'TEXT');
  await safeAlter('users', 'otp_expires', 'TIMESTAMPTZ');
  await safeAlter('users', 'signatures_count', 'INTEGER NOT NULL DEFAULT 0');
  await safeAlter('quotes', 'signer_name', 'TEXT');
  await safeAlter('relances', 'interval_hours', 'INTEGER NOT NULL DEFAULT 24');
  await safeAlter('relances', 'max_count', 'INTEGER NOT NULL DEFAULT 5');

  // ── Relances : colonne error_message pour les logs d'échec ──────────────
  await safeAlter('relance_logs', 'error_message', 'TEXT');

  // ── Index pour accélérer les lookups du scheduler ───────────────────────
  try {
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_relances_due
        ON relances (next_send_at)
        WHERE active = TRUE AND next_send_at IS NOT NULL;
    `);
  } catch (e) { /* ignoré si déjà présent */ }

  try {
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_relances_quote
        ON relances (quote_id, user_id);
    `);
  } catch (e) { /* ignoré */ }

  // ── CORRECTION FK : users.team_id ne doit PAS pointer vers teams(id) ──────
  // Le code utilise l'id du compte propriétaire directement comme team_id.
  // L'ancienne contrainte FK causait un code 23503 → erreur 500 à la création.
  try {
    await db.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_team_id_fkey');
    console.log('[migration] ✓ FK users.team_id supprimée (champ libre maintenant)');
  } catch (e) {
    if (!e.message.includes('does not exist'))
      console.warn('[migration] FK drop:', e.message);
  }

  // Même chose pour quotes et invoices si la FK vers teams existe
  try { await db.query('ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_team_id_fkey'); } catch (_) {}
  try { await db.query('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_team_id_fkey'); } catch (_) {}

  // ── Migration : comptes team_members orphelins → table users ──────────────
  // Les anciens comptes créés via l'ancienne route (table team_members)
  // n'étaient pas authentifiables. On les migre dans users.
  try {
    const orphans = await db.all(`
      SELECT tm.* FROM team_members tm
      LEFT JOIN users u ON u.email = tm.email
      WHERE u.id IS NULL
    `);
    if (orphans.length > 0) {
      console.log(`[migration] ${orphans.length} compte(s) team_members à migrer…`);
      for (const tm of orphans) {
        const owner = await db.get('SELECT id FROM users WHERE id = $1', [tm.owner_id]);
        if (!owner) continue;
        await db.run(
          `INSERT INTO users (id, email, name, password_hash, plan, role, team_id)
           VALUES ($1,$2,$3,$4,'team','member',$5)
           ON CONFLICT (email) DO NOTHING`,
          [tm.id, tm.email, tm.name, tm.password_hash, tm.owner_id]
        );
        console.log(`[migration] ✓ ${tm.email} migré vers users`);
      }
    }
  } catch (e) {
    if (!e.message.includes('does not exist'))
      console.warn('[migration] team_members→users:', e.message);
  }

  console.log('✅ Schema PostgreSQL initialisé + migrations appliquées');
}

initSchema().catch(err => {
  console.error('❌ Erreur init schema:', err.message);
  process.exit(1);
});

module.exports = { db, pool };
