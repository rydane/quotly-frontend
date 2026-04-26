#!/usr/bin/env node
/**
 * Migration script — ajoute les colonnes nécessaires aux nouvelles fonctionnalités
 * Exécuter UNE SEULE FOIS : node migrate.js
 */
'use strict';
require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || './data/quotly.db';
const db = new Database(dbPath);

console.log('🔧 Migration de la base de données...');

const migrations = [
  // 2FA / OTP
  { col: 'otp_code',           table: 'users',  type: 'TEXT' },
  { col: 'otp_expires',        table: 'users',  type: 'TEXT' },
  // Compteur de signatures
  { col: 'signatures_count',   table: 'users',  type: 'INTEGER DEFAULT 0' },
  // Nom du signataire sur le devis
  { col: 'signer_name',        table: 'quotes', type: 'TEXT' },
];

for (const { col, table, type } of migrations) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
    console.log(`  ✅ ${table}.${col} ajouté`);
  } catch (err) {
    if (err.message.includes('duplicate column')) {
      console.log(`  ⏭  ${table}.${col} déjà présent`);
    } else {
      console.error(`  ❌ ${table}.${col} erreur:`, err.message);
    }
  }
}

console.log('✅ Migration terminée.');
db.close();
