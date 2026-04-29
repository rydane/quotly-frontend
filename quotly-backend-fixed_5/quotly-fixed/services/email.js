'use strict';
const nodemailer = require('nodemailer');
const { db }     = require('../db/schema');
const { v4: uuidv4 } = require('uuid');

const GMAIL_USER   = process.env.GMAIL_USER;
const GMAIL_PASS   = process.env.GMAIL_PASS;
const EMAIL_FROM   = process.env.EMAIL_FROM || ('Quotly <' + GMAIL_USER + '>');
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://quotly-frontend.vercel.app';

function createTransport() {
  if (!GMAIL_USER || !GMAIL_PASS) {
    throw new Error('Email non configuré. Ajoutez GMAIL_USER et GMAIL_PASS dans les variables d\'environnement.');
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
}

async function sendMail({ to, subject, html, attachments = [] }) {
  const transporter = createTransport();
  return transporter.sendMail({ from: EMAIL_FROM, to, subject, html, attachments });
}

function htmlTemplate({ title, subtitle, body, ctaLabel, ctaUrl, color = '#2d4a2d' }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
<tr><td style="background:${color};padding:32px 40px;text-align:center">
<h1 style="color:#fff;margin:0;font-size:26px;font-weight:800">Quotly</h1>
<p style="color:rgba(255,255,255,.85);margin:6px 0 0;font-size:14px">Devis pro en 60 secondes</p>
</td></tr>
<tr><td style="padding:40px">
<h2 style="margin:0 0 8px;color:#111;font-size:20px">${title}</h2>
${subtitle ? `<p style="color:#666;margin:0 0 24px;font-size:14px">${subtitle}</p>` : ''}
<div style="color:#444;font-size:15px;line-height:1.7">${body}</div>
${ctaLabel && ctaUrl ? `<div style="margin:32px 0;text-align:center"><a href="${ctaUrl}" style="background:${color};color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block">${ctaLabel}</a></div>` : ''}
</td></tr>
<tr><td style="background:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #eee">
<p style="color:#999;font-size:12px;margin:0">© 2025 Quotly. Fait avec ♥ en France.</p>
</td></tr></table></td></tr></table></body></html>`;
}

async function sendWelcomeEmail({ to, name }) {
  const html = htmlTemplate({
    title: `Bienvenue sur Quotly, ${name} ! 🎉`,
    body: `<p>Bonjour ${name},</p><p>Votre compte est créé et prêt à l'emploi !</p>
<p>Avec le plan <strong>Starter gratuit</strong>, vous pouvez générer jusqu'à <strong>5 devis par mois</strong>.</p>
<p>Pour des devis illimités et toutes les fonctionnalités pro, passez au plan Pro.</p>`,
    ctaLabel: 'Créer mon premier devis →',
    ctaUrl: FRONTEND_URL,
  });
  return sendMail({ to, subject: 'Bienvenue sur Quotly ! 🚀', html });
}

async function sendQuoteEmail({ to, senderName, quoteNumber, pdfBuffer, signatureUrl, userId, quoteId }) {
  const html = htmlTemplate({
    title: `Votre devis ${quoteNumber}`,
    subtitle: `${senderName} vous a envoyé un devis via Quotly`,
    body: `<p>Bonjour,</p><p>Veuillez trouver ci-joint votre devis <strong>${quoteNumber}</strong>.</p>
<p>Vous pouvez consulter et signer ce devis directement en ligne :</p>`,
    ctaLabel: '✍️ Consulter et signer le devis',
    ctaUrl: signatureUrl,
  });
  await sendMail({
    to,
    subject: `Devis ${quoteNumber} — ${senderName}`,
    html,
    attachments: [{ filename: `${quoteNumber}.pdf`, content: pdfBuffer }],
  });
  // ✅ Utilise db.run() async (PostgreSQL) — PAS db.prepare().run() (SQLite)
  await db.run(
    "INSERT INTO email_logs (id, user_id, quote_id, to_email, subject, status) VALUES ($1,$2,$3,$4,$5,'sent')",
    [uuidv4(), userId, quoteId, to, `Devis ${quoteNumber}`]
  );
}

async function sendInvoiceEmail({ to, senderName, invoiceNumber, pdfBuffer, userId, invoiceId }) {
  const html = htmlTemplate({
    title: `Facture ${invoiceNumber}`,
    subtitle: `${senderName} vous a envoyé une facture via Quotly`,
    body: `<p>Bonjour,</p><p>Veuillez trouver ci-joint votre facture <strong>${invoiceNumber}</strong>.</p>
<p>Merci de procéder au règlement selon les conditions indiquées.</p>`,
    ctaLabel: null,
    ctaUrl: null,
  });
  await sendMail({
    to,
    subject: `Facture ${invoiceNumber} — ${senderName}`,
    html,
    attachments: [{ filename: `${invoiceNumber}.pdf`, content: pdfBuffer }],
  });
  await db.run(
    "INSERT INTO email_logs (id, user_id, invoice_id, to_email, subject, status) VALUES ($1,$2,$3,$4,$5,'sent')",
    [uuidv4(), userId, invoiceId, to, `Facture ${invoiceNumber}`]
  );
}

async function sendSignatureNotification({ to, senderName, quoteNumber, signerName }) {
  const html = htmlTemplate({
    title: `✅ Devis ${quoteNumber} accepté !`,
    subtitle: `${signerName} vient de signer votre devis`,
    body: `<p>Bonne nouvelle ! Votre devis <strong>${quoteNumber}</strong> a été signé par <strong>${signerName}</strong>.</p>
<p>Connectez-vous à votre espace Quotly pour le convertir en facture en un clic.</p>`,
    ctaLabel: 'Voir le devis signé',
    ctaUrl: FRONTEND_URL,
  });
  return sendMail({ to, subject: `✅ Devis ${quoteNumber} signé par ${signerName}`, html });
}

async function sendRelanceEmail({ to, senderName, quoteNumber, quoteId, signatureToken, attemptNumber, totalAmount }) {
  const signatureUrl = `${FRONTEND_URL}/sign/${signatureToken}`;

  const urgenceMsg = attemptNumber >= 3
    ? `<p style="background:#fff3cd;border-left:4px solid #ffc107;padding:12px 16px;border-radius:4px;margin:16px 0;color:#856404;font-size:14px">⏰ Ce devis approche de sa date d'expiration. N'attendez plus !</p>`
    : '';

  const html = htmlTemplate({
    title: `Rappel : votre devis ${quoteNumber} attend votre réponse`,
    subtitle: `${senderName} vous relance à propos de ce devis`,
    body: `<p>Bonjour,</p>
<p>Nous vous contactons car le devis <strong>${quoteNumber}</strong> envoyé par <strong>${senderName}</strong> est toujours en attente de votre réponse.</p>
${totalAmount ? `<p>Montant TTC : <strong>${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(totalAmount)}</strong></p>` : ''}
${urgenceMsg}
<p>Vous pouvez consulter, accepter ou refuser ce devis directement en ligne en cliquant sur le bouton ci-dessous.</p>
<p style="color:#999;font-size:13px;margin-top:24px">Relance automatique n°${attemptNumber} — Pour ne plus recevoir ces rappels, contactez directement ${senderName}.</p>`,
    ctaLabel: '📋 Consulter et répondre au devis',
    ctaUrl: signatureUrl,
    color: '#1a3a2a',
  });

  await sendMail({
    to,
    subject: `[Relance #${attemptNumber}] Devis ${quoteNumber} — ${senderName} attend votre réponse`,
    html,
  });

  // Log dans email_logs
  await db.run(
    "INSERT INTO email_logs (id, quote_id, to_email, subject, status) VALUES ($1,$2,$3,$4,'sent')",
    [uuidv4(), quoteId, to, `[Relance #${attemptNumber}] Devis ${quoteNumber}`]
  );
}

module.exports = { sendQuoteEmail, sendInvoiceEmail, sendWelcomeEmail, sendSignatureNotification, sendRelanceEmail };
