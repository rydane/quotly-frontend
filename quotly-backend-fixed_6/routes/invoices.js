'use strict';
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  try {
    const invoices = await db.all('SELECT * FROM invoices WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json({ invoices });
  } catch(err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { company_name, client_name, client_email, items, tva_rate, due_days, conditions } = req.body;
    if (!client_name || !company_name || !items?.length)
      return res.status(400).json({ error: 'Champs obligatoires manquants.' });

    const id = uuidv4();
    const count = await db.get('SELECT COUNT(*) as n FROM invoices WHERE user_id = $1', [req.user.id]);
    const number = `FAC-${String(parseInt(count.n || 0) + 1).padStart(4, '0')}`;

    await db.run(
      `INSERT INTO invoices (id, user_id, number, client_name, client_email, company_name, items, tva_rate, due_days, conditions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, req.user.id, number, client_name, client_email || '', company_name, JSON.stringify(items), tva_rate || 20, due_days || 30, conditions || '']
    );

    const invoice = await db.get('SELECT * FROM invoices WHERE id = $1', [id]);
    res.status(201).json({ invoice });
  } catch(err) { console.error('invoice:', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

router.post('/from-quote/:quoteId', requireAuth, async (req, res) => {
  try {
    const quote = await db.get('SELECT * FROM quotes WHERE id = $1 AND user_id = $2', [req.params.quoteId, req.user.id]);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable.' });
    const id = uuidv4();
    const count = await db.get('SELECT COUNT(*) as n FROM invoices WHERE user_id = $1', [req.user.id]);
    const number = `FAC-${String(parseInt(count.n || 0) + 1).padStart(4, '0')}`;
    await db.run(
      `INSERT INTO invoices (id, user_id, quote_id, number, client_name, client_email, company_name, items, tva_rate, due_days, conditions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, req.user.id, quote.id, number, quote.client_name, quote.client_email, quote.company_name, JSON.stringify(quote.items), quote.tva_rate, quote.validity_days, quote.conditions]
    );
    await db.run("UPDATE quotes SET status = 'accepted' WHERE id = $1", [quote.id]);
    const invoice = await db.get('SELECT * FROM invoices WHERE id = $1', [id]);
    res.status(201).json({ invoice });
  } catch(err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

module.exports = router;
