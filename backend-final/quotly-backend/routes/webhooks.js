'use strict';
const express = require('express');
const https   = require('https');
const { v4: uuidv4 } = require('uuid');
const { db }  = require('../db/schema');

const router = express.Router();

/**
 * Vérifie la signature PayPal du webhook via leur API
 */
async function verifyPayPalWebhook(headers, rawBody) {
  // En production : vérifier avec l'API PayPal
  // POST https://api.paypal.com/v1/notifications/verify-webhook-signature
  // Pour le dev, on accepte tout (désactiver en prod !)
  if (process.env.NODE_ENV !== 'production') return true;

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      transmission_id:   headers['paypal-transmission-id'],
      transmission_time: headers['paypal-transmission-time'],
      cert_url:          headers['paypal-cert-url'],
      auth_algo:         headers['paypal-auth-algo'],
      transmission_sig:  headers['paypal-transmission-sig'],
      webhook_id:        process.env.PAYPAL_WEBHOOK_ID,
      webhook_event:     JSON.parse(rawBody),
    });

    const options = {
      hostname: process.env.PAYPAL_MODE === 'live' ? 'api.paypal.com' : 'api.sandbox.paypal.com',
      path: '/v1/notifications/verify-webhook-signature',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.verification_status === 'SUCCESS');
        } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.write(payload);
    req.end();
  });
}

/** Détermine le plan depuis le payment_id PayPal */
function getPlanFromPayPal(resourceId) {
  if (resourceId === process.env.PAYPAL_PLAN_TEAM) return 'team';
  if (resourceId === process.env.PAYPAL_PLAN_PRO)  return 'pro';
  return null;
}

/**
 * POST /api/webhooks/paypal
 * Corps brut pour vérification de signature
 */
router.post('/paypal', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const rawBody = req.body.toString();
    const event   = JSON.parse(rawBody);

    const valid = await verifyPayPalWebhook(req.headers, rawBody);
    if (!valid) {
      console.warn('PayPal webhook signature invalide');
      return res.status(400).json({ error: 'Signature invalide.' });
    }

    // Idempotence
    const already = db.prepare('SELECT id FROM paypal_events WHERE id = ?').get(event.id);
    if (already) return res.json({ status: 'already_processed' });

    db.prepare(`INSERT INTO paypal_events (id, event_type, resource_id, payload)
      VALUES (?, ?, ?, ?)`
    ).run(event.id, event.event_type, event.resource?.id || null, rawBody);

    console.log(`[PayPal webhook] ${event.event_type}`, event.resource?.id);

    switch (event.event_type) {
      // ── Paiement réussi (one-time ou abonnement) ──────────────────────────
      case 'PAYMENT.CAPTURE.COMPLETED':
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        const subId   = event.resource?.id;
        const planId  = event.resource?.plan_id || event.resource?.billing_plan_id;
        const plan    = getPlanFromPayPal(planId);

        if (!plan) {
          console.warn('Plan PayPal inconnu :', planId);
          break;
        }

        // Trouver l'user par email PayPal ou sub_id
        const payerEmail = event.resource?.subscriber?.email_address
          || event.resource?.payer?.email_address;

        let user = null;
        if (payerEmail) {
          user = db.prepare('SELECT id FROM users WHERE email = ?').get(payerEmail.toLowerCase());
        }
        if (!user && subId) {
          user = db.prepare('SELECT id FROM users WHERE paypal_sub_id = ?').get(subId);
        }

        if (user) {
          const expiresAt = new Date(Date.now() + 31 * 24 * 3600 * 1000).toISOString();
          db.prepare(`UPDATE users SET plan = ?, paypal_sub_id = ?, plan_expires_at = ? WHERE id = ?`)
            .run(plan, subId || null, expiresAt, user.id);
          console.log(`[PayPal] User ${user.id} → plan ${plan}`);
        } else {
          console.warn('[PayPal] Aucun user trouvé pour', payerEmail, subId);
        }
        break;
      }

      // ── Annulation / suspension abonnement ────────────────────────────────
      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
      case 'BILLING.SUBSCRIPTION.EXPIRED': {
        const subId = event.resource?.id;
        if (subId) {
          db.prepare(`UPDATE users SET plan = 'starter', paypal_sub_id = NULL, plan_expires_at = NULL
            WHERE paypal_sub_id = ?`
          ).run(subId);
          console.log(`[PayPal] Abonnement ${subId} annulé → downgrade starter`);
        }
        break;
      }

      default:
        // Événement non géré, on l'a quand même loggé en DB
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook PayPal error:', err);
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

/**
 * POST /api/webhooks/paypal/activate-manual
 * Activation manuelle par email (pour test ou support)
 * Protégé par secret admin
 */
router.post('/paypal/activate-manual', (req, res) => {
  const { secret, email, plan } = req.body;
  if (secret !== process.env.JWT_SECRET) {
    return res.status(403).json({ error: 'Non autorisé.' });
  }
  if (!['pro', 'team', 'starter'].includes(plan)) {
    return res.status(400).json({ error: 'Plan invalide.' });
  }

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  const expiresAt = plan !== 'starter'
    ? new Date(Date.now() + 31 * 24 * 3600 * 1000).toISOString()
    : null;

  db.prepare('UPDATE users SET plan = ?, plan_expires_at = ? WHERE id = ?')
    .run(plan, expiresAt, user.id);

  res.json({ message: `Plan ${plan} activé pour ${email}.` });
});

module.exports = router;
