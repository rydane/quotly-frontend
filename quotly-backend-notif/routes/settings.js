'use strict';
const router = require('express').Router();
const { db } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

// GET /api/settings
router.get('/', requireAuth, async (req, res) => {
  try {
    let settings = await db.get('SELECT * FROM settings WHERE user_id = $1', [req.user.id]);
    if (!settings) settings = { user_id: req.user.id, company_name:'', company_address:'', company_email:'', company_phone:'', siret:'', logo_url:'' };
    res.json({ settings });
  } catch(err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

// PUT /api/settings
router.put('/', requireAuth, async (req, res) => {
  try {
    const { company_name, company_address, company_email, company_phone, siret, logo_url } = req.body;
    const existing = await db.get('SELECT user_id FROM settings WHERE user_id = $1', [req.user.id]);

    if (existing) {
      await db.run(
        'UPDATE settings SET company_name=$1, company_address=$2, company_email=$3, company_phone=$4, siret=$5, logo_url=$6, updated_at=NOW() WHERE user_id=$7',
        [company_name||'', company_address||'', company_email||'', company_phone||'', siret||'', logo_url||'', req.user.id]
      );
    } else {
      await db.run(
        'INSERT INTO settings (user_id, company_name, company_address, company_email, company_phone, siret, logo_url) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [req.user.id, company_name||'', company_address||'', company_email||'', company_phone||'', siret||'', logo_url||'']
      );
    }
    const settings = await db.get('SELECT * FROM settings WHERE user_id = $1', [req.user.id]);
    res.json({ settings });
  } catch(err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

module.exports = router;
