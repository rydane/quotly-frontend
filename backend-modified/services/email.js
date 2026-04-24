'use strict';
const { db } = require('../db/schema');
const { v4: uuidv4 } = require('uuid');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'onboarding@resend.dev';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://quotly-devis.netlify.app';

async function resendSend({ to, subject, html, attachments = [] }) {
  const body = { from: EMAIL_FROM, to, subject, html };
  if (attachments.length > 0) {
    body.attachments = attachments.map(a => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content)
        ? a.content.toString('base64')
        : Buffer.from(a.content).toString('base64'),
    }));
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Resend error: ' + JSON.stringify(data));
  return data;
}

function htmlTemplate({ title, subtitle, body, ctaLabel, ctaUrl, color = '#2d4a2d' }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 20px">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
        <tr><td style="background:${color};padding:32px 40px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:26px;font-weight:800">Quotly</h1>
          <p style="color:rgba(255,255,255,.85);margin:6px 0 0;font-size:14px">Devis pro en 60 secondes</p>
        </td></tr>
        <tr><td style="padding:40px">
          <h2 style="margin:0 0 8px;color:#111;font-size:20px">${title}</h2>
          ${subtitle ? `<p style="color:#666;margin:0 0 24px;font-size:14px">${subtitle}</p>` : ''}
          <div style="color:#444;font-size:15px;line-height:1.7">${body}</div>
          ${ctaLabel && ctaUrl ? `
          <div style="margin:32px 0;text-align:center">
            <a href="${ctaUrl}" style="background:${color};color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block">${ctaLabel}</a>
          </div>` : ''}
        </td></tr>
        <tr><td style="background:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #eee">
          <p style="color:#999;font-size:12px;margin:0">© 2024 Quotly. Fait avec ♥ en France.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendWelcomeEmail({ to, name }) {
  const html = htmlTemplate({
    title: `Bienvenue sur Quotly, ${name} ! 🎉`,
    body: `
      <p>Bonjour ${name},</p>
      <p>Votre compte est créé et prêt à l'emploi !</p>
      <p>Avec le plan <strong>Starter gratuit</strong>, vous pouvez générer jusqu'à <strong>5 devis par mois</strong>.</p>
      <p>Pour des devis illimités et toutes les fonctionnalités pro, passez au plan Pro.</p>
    `,
    ctaLabel: 'Créer mon premier devis →',
    ctaUrl: FRONTEND_URL,
  });
  return resendSend({ to, subject: 'Bienvenue sur Quotly ! 🚀', html });
}

async function sendQuoteEmail({ to, senderName, quoteNumber, pdfBuffer, signatureUrl, userId, quoteId }) {
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
  const info = await resendSend({
    to, subject: `Devis ${quoteNumber} — ${senderName}`, html,
    attachments: [{ filename: `${quoteNumber}.pdf`, content: pdfBuffer }],
  });
  db.prepare(`INSERT INTO email_logs (id, user_id, quote_id, to_email, subject, status) VALUES (?, ?, ?, ?, ?, 'sent')`)
    .run(uuidv4(), userId, quoteId, to, `Devis ${quoteNumber}`);
  return info;
}

async function sendInvoiceEmail({ to, senderName, invoiceNumber, pdfBuffer, userId, invoiceId }) {
  const html = htmlTemplate({
    title: `Facture ${invoiceNumber}`,
    subtitle: `${senderName} vous a envoyé une facture via Quotly`,
    body: `<p>Bonjour,</p><p>Veuillez trouver ci-joint votre facture <strong>${invoiceNumber}</strong>.</p><p>Merci de procéder au règlement selon les conditions indiquées.</p>`,
    ctaLabel: null, ctaUrl: null,
  });
  const info = await resendSend({
    to, subject: `Facture ${invoiceNumber} — ${senderName}`, html,
    attachments: [{ filename: `${invoiceNumber}.pdf`, content: pdfBuffer }],
  });
  db.prepare(`INSERT INTO email_logs (id, user_id, invoice_id, to_email, subject, status) VALUES (?, ?, ?, ?, ?, 'sent')`)
    .run(uuidv4(), userId, invoiceId, to, `Facture ${invoiceNumber}`);
  return info;
}

async function sendSignatureNotification({ to, senderName, quoteNumber, signerName }) {
  const html = htmlTemplate({
    title: `✅ Devis ${quoteNumber} accepté !`,
    subtitle: `${signerName} vient de signer votre devis`,
    body: `<p>Bonne nouvelle ! Votre devis <strong>${quoteNumber}</strong> a été signé par <strong>${signerName}</strong>.</p><p>Connectez-vous à votre espace Quotly pour le convertir en facture en un clic.</p>`,
    ctaLabel: 'Voir le devis signé', ctaUrl: FRONTEND_URL,
  });
  return resendSend({ to, subject: `✅ Devis ${quoteNumber} signé par ${signerName}`, html });
}

module.exports = { sendQuoteEmail, sendInvoiceEmail, sendWelcomeEmail, sendSignatureNotification };
