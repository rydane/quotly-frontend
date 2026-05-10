'use strict';
const router = require('express').Router();
const crypto = require('crypto');
const { db } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

// Helper: créer une notification pour un utilisateur (utilisable depuis d'autres routes)
async function createNotification({ user_id, type, title, message, data }) {
  try {
    const id = crypto.randomUUID();
    await db.run(
      `INSERT INTO notifications (id, user_id, type, title, message, data, read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, NOW())`,
      [id, user_id, type || 'info', title, message || '', JSON.stringify(data || {})]
    );
    return id;
  } catch (err) {
    console.error('[notifications] createNotification:', err.message);
    return null;
  }
}

// GET /api/notifications — liste les notifs de l'utilisateur connecté
router.get('/', requireAuth, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, type, title, message, data, read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.user.id]
    );
    const unread = await db.get(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read = FALSE',
      [req.user.id]
    );
    res.json({ notifications: rows, unread_count: unread?.count || 0 });
  } catch (err) {
    console.error('GET /notifications:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/notifications/unread-count — compteur rapide (badge)
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const row = await db.get(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read = FALSE',
      [req.user.id]
    );
    res.json({ count: row?.count || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/notifications/:id/read — marquer comme lue
router.put('/:id/read', requireAuth, async (req, res) => {
  try {
    await db.run(
      'UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/notifications/read-all — tout marquer comme lu
router.put('/read-all', requireAuth, async (req, res) => {
  try {
    await db.run(
      'UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE',
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/notifications/:id — supprimer une notif
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await db.run(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/notifications — supprimer toutes les notifs
router.delete('/', requireAuth, async (req, res) => {
  try {
    await db.run('DELETE FROM notifications WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = { router, createNotification };
