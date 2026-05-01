'use strict';
const router = require('express').Router();
const { db } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

// ─── GET /api/notifications — liste des notifs de l'utilisateur ──────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, type, title, message, quote_id, read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    const unread = rows.filter(n => !n.read).length;
    res.json({ notifications: rows, unread });
  } catch (err) {
    console.error('notifications GET:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── PATCH /api/notifications/:id/read — marquer une notif comme lue ─────────
router.patch('/:id/read', requireAuth, async (req, res) => {
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

// ─── PATCH /api/notifications/read-all — tout marquer comme lu ───────────────
router.patch('/read-all', requireAuth, async (req, res) => {
  try {
    await db.run(
      'UPDATE notifications SET read = TRUE WHERE user_id = $1',
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── DELETE /api/notifications/:id — supprimer une notif ─────────────────────
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

module.exports = router;
