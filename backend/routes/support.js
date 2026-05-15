'use strict';
const router      = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { db }      = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

const ADMIN_EMAILS = ['berkiadam92@gmail.com', 'rydane.j@gmail.com', 'tapasoumbounou@gmail.com'];

function isAdmin(email) {
  return ADMIN_EMAILS.includes(email?.toLowerCase());
}

// POST /api/support/message — tout utilisateur authentifie peut envoyer un message
router.post('/message', requireAuth, async (req, res) => {
  try {
    const { subject, message } = req.body;
    if (!subject || !message) return res.status(400).json({ error: 'Sujet et message requis.' });

    const id = uuidv4();
    await db.run(
      `INSERT INTO support_messages (id, user_id, user_email, user_name, user_plan, subject, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, req.user.id, req.user.email, req.user.name, req.user.plan || 'starter', subject.trim(), message.trim()]
    );

    res.status(201).json({ id, message: 'Message envoye au support.' });
  } catch (err) {
    console.error('support/message:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/support/my-messages — utilisateur : voir ses propres messages + reponses admin
router.get('/my-messages', requireAuth, async (req, res) => {
  try {
    const messages = await db.all(
      `SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ messages });
  } catch (err) {
    console.error('support/my-messages:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/support/messages — admin uniquement : lister tous les messages
router.get('/messages', requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.email)) return res.status(403).json({ error: 'Acces refuse.' });

    const messages = await db.all(
      `SELECT * FROM support_messages ORDER BY created_at DESC`
    );
    res.json({ messages });
  } catch (err) {
    console.error('support/messages:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/support/messages/unread-count — admin uniquement : nombre de messages non lus
router.get('/messages/unread-count', requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.email)) return res.status(403).json({ error: 'Acces refuse.' });

    const row = await db.get(
      `SELECT COUNT(*) as count FROM support_messages WHERE read = FALSE`
    );
    res.json({ count: parseInt(row?.count || '0') });
  } catch (err) {
    console.error('support/unread-count:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/support/messages/:id/read — admin uniquement : marquer comme lu
router.put('/messages/:id/read', requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.email)) return res.status(403).json({ error: 'Acces refuse.' });

    await db.run(
      `UPDATE support_messages SET read = TRUE WHERE id = $1`,
      [req.params.id]
    );
    res.json({ message: 'Marque comme lu.' });
  } catch (err) {
    console.error('support/read:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/support/messages/:id/reply — admin uniquement : repondre a un message
router.post('/messages/:id/reply', requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.email)) return res.status(403).json({ error: 'Acces refuse.' });

    const { reply } = req.body;
    if (!reply) return res.status(400).json({ error: 'Reponse requise.' });

    const msg = await db.get('SELECT * FROM support_messages WHERE id = $1', [req.params.id]);
    if (!msg) return res.status(404).json({ error: 'Message introuvable.' });

    // Ajouter la reponse au tableau JSONB replies
    const replies = Array.isArray(msg.replies) ? msg.replies : [];
    replies.push({
      id: uuidv4(),
      admin_email: req.user.email,
      admin_name: req.user.name,
      reply: reply.trim(),
      created_at: new Date().toISOString(),
    });

    await db.run(
      `UPDATE support_messages SET replies = $1::jsonb, read = TRUE WHERE id = $2`,
      [JSON.stringify(replies), req.params.id]
    );

    res.json({ message: 'Reponse envoyee.', replies });
  } catch (err) {
    console.error('support/reply:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/support/messages/:id — admin uniquement : supprimer un message
router.delete('/messages/:id', requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.email)) return res.status(403).json({ error: 'Acces refuse.' });

    await db.run('DELETE FROM support_messages WHERE id = $1', [req.params.id]);
    res.json({ message: 'Message supprime.' });
  } catch (err) {
    console.error('support/delete:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
