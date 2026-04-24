'use strict';
const nodemailer = require('nodemailer');
const { db } = require('../db/schema');
const { v4: uuidv4 } = require('uuid');

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transporter;
}

/**
 * Template HTML générique pour les emails Quotly
 */
function htmlTemplate({ title, subtitle, body, ctaLabel, ctaUrl, color = '#4f46e5' }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 20px">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
        <!-- Header -->
        <tr><td style="background:${color};padding:32px 40px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:26px;font-weight:800">Quotly</h1>
          <p style="color:rgba(255,255,255,.85);margin:6px 0 0;font-size:14px">Devis pro en 60 secondes</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px">
          <h2 style="margin:0 0 8px;color:#111;font-size:20px">${title}</h2>
          ${subtitle ? `<p style="color:#666;margin:0 0 24px;font-size:14px">${subtitle}</p>` : ''}
          <div style="color:#444;font-size:15px;line-height:1.7">${body}</div>
          ${ctaLabel && ctaUrl ? `
          <div style="margin:32px 0;text-align:center">
            <a href="${ctaUrl}" style="background:${color};color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block">${ctaLabel}</a>
          </div>` : ''}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #eee">
          <p style="color:#999;font-size:12px;margin:0">Quotly · <a href="mailto:contact@quotly.fr" style="color:#999">contact@quotly.fr</a></p>
          <p style="color:#bbb;font-size:11px;margin:4px 0 0">© 2024 Quotly. Fait avec ♥ en France.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Envoie un email avec la pièce jointe PDF du devis
 */
async function sendQuoteEmail({ to, senderName, quoteNumber, pdfBuffer, signatureUrl, userId, quoteId }) {
  const transporter = getTransporter();

  const html = htmlTemplate({
    title: `Votre devis ${quoteNumber}`,
    subtitle: `${senderName} vous a envoyé un devis via Quotly`,
    body: `
      <p>Bonjour,</p>
      <p>Veuillez trouver ci-joint votre devis <strong>${quoteNumber}</strong>.</p>
      <p>Vous pouvez consulter et signer ce devis directement en ligne :</p>
    `,
    ctaLabel: '✍️ Consulter et signer le devis',
    ctaUrl: signatureUrl,
  });

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || `"${senderName}" <contact@quotly.fr>`,
    to,
    subject: `Devis ${quoteNumber} — ${senderName}`,
    html,
    attachments: [{
      filename: `${quoteNumber}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }],
  });

  // Log
  db.prepare(`INSERT INTO email_logs (id, user_id, quote_id, to_email, subject, status)
    VALUES (?, ?, ?, ?, ?, 'sent')`
  ).run(uuidv4(), userId, quoteId, to, `Devis ${quoteNumber}`);

  return info;
}

/**
 * Envoie un email avec le PDF de la facture
 */
async function sendInvoiceEmail({ to, senderName, invoiceNumber, pdfBuffer, userId, invoiceId }) {
  const transporter = getTransporter();

  const html = htmlTemplate({
    title: `Facture ${invoiceNumber}`,
    subtitle: `${senderName} vous a envoyé une facture via Quotly`,
    body: `
      <p>Bonjour,</p>
      <p>Veuillez trouver ci-joint votre facture <strong>${invoiceNumber}</strong>.</p>
      <p>Merci de procéder au règlement selon les conditions indiquées.</p>
    `,
    ctaLabel: null,
    ctaUrl: null,
  });

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || `"${senderName}" <contact@quotly.fr>`,
    to,
    subject: `Facture ${invoiceNumber} — ${senderName}`,
    html,
    attachments: [{
      filename: `${invoiceNumber}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }],
  });

  db.prepare(`INSERT INTO email_logs (id, user_id, invoice_id, to_email, subject, status)
    VALUES (?, ?, ?, ?, ?, 'sent')`
  ).run(uuidv4(), userId, invoiceId, to, `Facture ${invoiceNumber}`);

  return info;
}

/**
 * Email de bienvenue à l'inscription
 */
async function sendWelcomeEmail({ to, name }) {
  const transporter = getTransporter();
  const html = htmlTemplate({
    title: `Bienvenue sur Quotly, ${name} ! 🎉`,
    body: `
      <p>Votre compte est créé et prêt à l'emploi.</p>
      <p>Avec le plan <strong>Starter gratuit</strong>, vous pouvez générer jusqu'à <strong>5 devis par mois</strong>.</p>
      <p>Pour des devis illimités et toutes les fonctionnalités pro, passez au plan Pro à 29€/mois.</p>
    `,
    ctaLabel: 'Créer mon premier devis →',
    ctaUrl: process.env.FRONTEND_URL || 'https://quotly-devis.netlify.app',
  });
  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: 'Bienvenue sur Quotly ! 🚀',
    html,
  });
}

/**
 * Email de notification : devis signé
 */
async function sendSignatureNotification({ to, senderName, quoteNumber, signerName }) {
  const transporter = getTransporter();
  const html = htmlTemplate({
    title: `✅ Devis ${quoteNumber} accepté !`,
    subtitle: `${signerName} vient de signer votre devis`,
    body: `
      <p>Bonne nouvelle ! Votre devis <strong>${quoteNumber}</strong> a été signé par <strong>${signerName}</strong>.</p>
      <p>Connectez-vous à votre espace Quotly pour le convertir en facture en un clic.</p>
    `,
    ctaLabel: 'Voir le devis signé',
    ctaUrl: process.env.FRONTEND_URL || 'https://quotly-devis.netlify.app',
  });
  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: `✅ Devis ${quoteNumber} signé par ${signerName}`,
    html,
  });
}

module.exports = { sendQuoteEmail, sendInvoiceEmail, sendWelcomeEmail, sendSignatureNotification };
