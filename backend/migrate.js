#!/usr/bin/env node
/**
 * Migration PostgreSQL — ajoute les colonnes nécessaires
 * Exécuter UNE SEULE FOIS (ou autant de fois que nécessaire, idempotent) :
 *   node migrate.js
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : false,
});

async function migrate() {
  const client = await pool.connect();
  console.log('🔧 Migration PostgreSQL...');
  try {
    const migrations = [
      { table: 'users',  col: 'otp_code',          type: 'TEXT' },
      { table: 'users',  col: 'otp_expires',        type: 'TIMESTAMPTZ' },
      { table: 'users',  col: 'signatures_count',   type: 'INTEGER NOT NULL DEFAULT 0' },
      { table: 'quotes', col: 'signer_name',         type: 'TEXT' },
    ];

    for (const { table, col, type } of migrations) {
      try {
        await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`);
        console.log(`  ✅ ${table}.${col} — OK`);
      } catch (err) {
        console.log(`  ⚠️  ${table}.${col} — ${err.message}`);
      }
    }

    console.log('✅ Migration terminée.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('❌ Erreur migration:', err.message);
  process.exit(1);
});
