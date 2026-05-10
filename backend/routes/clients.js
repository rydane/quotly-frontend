'use strict';
/**
 * Module CRM — Clients
 * ─────────────────────────────────────────────────────────────────────────────
 *  Routes :
 *    GET    /api/clients               → liste tous les clients de l'utilisateur (avec stats agrégées)
 *    POST   /api/clients               → crée un client
 *    GET    /api/clients/:id           → détail d'un client
 *    PUT    /api/clients/:id           → met à jour un client
 *    DELETE /api/clients/:id           → supprime un client (les devis/factures associés
 *                                         conservent les données mais perdent le lien client_id)
 *    GET    /api/clients/:id/history   → historique : devis + factures de ce client
 *
 *  Le module CRM est réservé aux plans payants (pro, team). Le plan starter
 *  reçoit un 403 avec upgrade=true pour déclencher le modal d'upgrade.
 *
 *  Limite anti-abus : 1000 clients max par compte. Au-delà, créer une nouvelle
 *  fiche renvoie un 429 → suggérer d'archiver des fiches.
 */
const router       = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { db }       = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

const MAX_CLIENTS_PER_USER = 1000;

// Bloque l'accès aux comptes starter
function requirePaidPlan(req, res, next) {
  if (req.user.plan === 'starter') {
    return res.status(403).json({
      error: 'Le module Clients (CRM) est réservé aux plans Pro et Équipe.',
      upgrade: true,
    });
  }
  next();
}

// Validation simple
function validateClientPayload(body) {
  const errors = [];
  if (!body.name && !body.company) errors.push('Indiquez un nom ou une entreprise.');
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) errors.push('Email invalide.');
  if (body.tag && !['lead', 'active', 'archived'].includes(body.tag)) errors.push('Statut invalide.');
  // Limites de longueur (anti-abus)
  for (const f of ['name', 'company', 'email', 'phone', 'address', 'siret', 'tva']) {
    if (body[f] && String(body[f]).length > 255) errors.push(`Champ ${f} trop long.`);
  }
  if (body.notes && String(body.notes).length > 5000) errors.push('Notes trop longues (5000 car max).');
  return errors;
}

// Sanitise les champs sortants (pas d'injection HTML dans le frontend)
function clean(s) {
  if (s == null) return null;
  return String(s).slice(0, 5000);
}

// ─── GET /api/clients ─────────────────────────────────────────────────────────
// Liste avec stats agrégées (nb devis, nb factures, CA total)
router.get('/', requireAuth, requirePaidPlan, async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT
        c.id, c.name, c.company, c.email, c.phone, c.address,
        c.siret, c.tva, c.tag, c.notes, c.created_at, c.updated_at,
        COALESCE(q.cnt, 0)::int       AS quotes_count,
        COALESCE(i.cnt, 0)::int       AS invoices_count,
        COALESCE(i.revenue, 0)::float AS total_revenue
      FROM clients c
      LEFT JOIN (
        SELECT client_id, COUNT(*) AS cnt
        FROM quotes WHERE user_id = $1 AND client_id IS NOT NULL
        GROUP BY client_id
      ) q ON q.client_id = c.id
      LEFT JOIN (
        SELECT
          client_id,
          COUNT(*) AS cnt,
          SUM(
            -- somme des items (qty * unit_price) pondérés par TVA
            (SELECT COALESCE(SUM((it->>'qty')::float * (it->>'unit_price')::float), 0)
             FROM jsonb_array_elements(items) it)
            * (1 + COALESCE(tva_rate, 20)::float / 100)
          ) AS revenue
        FROM invoices WHERE user_id = $1 AND client_id IS NOT NULL
        GROUP BY client_id
      ) i ON i.client_id = c.id
      WHERE c.user_id = $1
      ORDER BY c.updated_at DESC
      LIMIT 1000
    `, [req.user.id]);
    res.json({ clients: rows });
  } catch (err) {
    console.error('[clients GET]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── POST /api/clients ────────────────────────────────────────────────────────
router.post('/', requireAuth, requirePaidPlan, async (req, res) => {
  try {
    const errors = validateClientPayload(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });

    // Vérifie la limite anti-abus
    const { count } = await db.get(
      'SELECT COUNT(*)::int AS count FROM clients WHERE user_id = $1',
      [req.user.id]
    );
    if (count >= MAX_CLIENTS_PER_USER) {
      return res.status(429).json({
        error: `Limite de ${MAX_CLIENTS_PER_USER} clients atteinte. Archivez ou supprimez d'anciennes fiches.`,
      });
    }

    const id = uuidv4();
    await db.run(`
      INSERT INTO clients
        (id, user_id, team_id, name, company, email, phone, address, siret, tva, tag, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      id,
      req.user.id,
      req.user.team_id || null,
      clean(req.body.name) || null,
      clean(req.body.company) || null,
      clean(req.body.email) || null,
      clean(req.body.phone) || null,
      clean(req.body.address) || null,
      clean(req.body.siret) || null,
      clean(req.body.tva) || null,
      req.body.tag || 'lead',
      clean(req.body.notes) || null,
    ]);

    const created = await db.get('SELECT * FROM clients WHERE id = $1', [id]);
    res.json({ client: created });
  } catch (err) {
    console.error('[clients POST]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── GET /api/clients/:id ─────────────────────────────────────────────────────
router.get('/:id', requireAuth, requirePaidPlan, async (req, res) => {
  try {
    const c = await db.get(
      'SELECT * FROM clients WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!c) return res.status(404).json({ error: 'Client introuvable.' });
    res.json({ client: c });
  } catch (err) {
    console.error('[clients GET/:id]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── PUT /api/clients/:id ─────────────────────────────────────────────────────
router.put('/:id', requireAuth, requirePaidPlan, async (req, res) => {
  try {
    const existing = await db.get(
      'SELECT id FROM clients WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!existing) return res.status(404).json({ error: 'Client introuvable.' });

    const errors = validateClientPayload({ ...req.body, name: req.body.name || 'x' });
    // ↑ la validation exige name OU company ; sur un PUT on peut ne mettre à jour que tag.
    // On filtre pour n'inclure que les champs présents dans le body :
    const ALLOWED = ['name', 'company', 'email', 'phone', 'address', 'siret', 'tva', 'tag', 'notes'];
    const updates = [];
    const values  = [];
    let i = 1;
    for (const f of ALLOWED) {
      if (req.body[f] !== undefined) {
        // Validation ciblée
        if (f === 'tag' && !['lead', 'active', 'archived'].includes(req.body.tag)) {
          return res.status(400).json({ error: 'Statut invalide.' });
        }
        if (f === 'email' && req.body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email)) {
          return res.status(400).json({ error: 'Email invalide.' });
        }
        updates.push(`${f} = $${i++}`);
        values.push(clean(req.body[f]));
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Aucune donnée à mettre à jour.' });
    updates.push(`updated_at = NOW()`);
    values.push(req.params.id);
    values.push(req.user.id);

    await db.run(
      `UPDATE clients SET ${updates.join(', ')} WHERE id = $${i++} AND user_id = $${i}`,
      values
    );
    const updated = await db.get('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    res.json({ client: updated });
  } catch (err) {
    console.error('[clients PUT]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── DELETE /api/clients/:id ──────────────────────────────────────────────────
// Supprime le client. Les devis/factures associés gardent leur historique
// mais leur colonne client_id devient NULL (FK ON DELETE SET NULL).
router.delete('/:id', requireAuth, requirePaidPlan, async (req, res) => {
  try {
    const existing = await db.get(
      'SELECT id FROM clients WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!existing) return res.status(404).json({ error: 'Client introuvable.' });
    await db.run('DELETE FROM clients WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[clients DELETE]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── GET /api/clients/:id/history ─────────────────────────────────────────────
// Renvoie tous les devis + factures liés à ce client
router.get('/:id/history', requireAuth, requirePaidPlan, async (req, res) => {
  try {
    const client = await db.get(
      'SELECT id FROM clients WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!client) return res.status(404).json({ error: 'Client introuvable.' });

    const quotes = await db.all(`
      SELECT id, number, status, items, tva_rate, created_at,
             (SELECT COALESCE(SUM((it->>'qty')::float * (it->>'unit_price')::float), 0)
              FROM jsonb_array_elements(items) it)
              * (1 + COALESCE(tva_rate, 20)::float / 100) AS total_ttc
      FROM quotes
      WHERE user_id = $1 AND client_id = $2
      ORDER BY created_at DESC
      LIMIT 100
    `, [req.user.id, req.params.id]);

    const invoices = await db.all(`
      SELECT id, number, status, items, tva_rate, created_at,
             (SELECT COALESCE(SUM((it->>'qty')::float * (it->>'unit_price')::float), 0)
              FROM jsonb_array_elements(items) it)
              * (1 + COALESCE(tva_rate, 20)::float / 100) AS total_ttc
      FROM invoices
      WHERE user_id = $1 AND client_id = $2
      ORDER BY created_at DESC
      LIMIT 100
    `, [req.user.id, req.params.id]);

    res.json({ quotes, invoices });
  } catch (err) {
    console.error('[clients history]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
