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
    throw new Error('Email non configuré. Ajoutez GMAIL_USER et GMAIL_PASS dans les variables Render.');
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
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px"><table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)"><tr><td style="background:' + color + ';padding:32px 40px;text-align:center"><h1 style="color:#fff;margin:0;font-size:26px;font-weight:800">Quotly</h1><p style="color:rgba(255,255,255,.85);margin:6px 0 0;font-size:14px">Devis pro en 60 secondes</p></td></tr><tr><td style="padding:40px"><h2 style="margin:0 0 8px;color:#111;font-size:20px">' + title + '</h2>' + (subtitle ? '<p style="color:#666;margin:0 0 24px;font-size:14px">' + subtitle + '</p>' : '') + '<div style="color:#444;font-size:15px;line-height:1.7">' + body + '</div>' + (ctaLabel && ctaUrl ? '<div style="margin:32px 0;text-align:center"><a href="' + ctaUrl + '" style="background:' + color + ';color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block">' + ctaLabel + '</a></div>' : '') + '</td></tr><tr><td style="background:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #eee"><p style="color:#999;font-size:12px;margin:0">\u00a9 2025 Quotly. Fait avec \u2665 en France.</p></td></tr></table></td></tr></table></body></html>';
}

async function sendWelcomeEmail({ to, name }) {
  const html = htmlTemplate({
    title: 'Bienvenue sur Quotly, ' + name + ' ! \uD83C\uDF89',
    body: '<p>Bonjour ' + name + ',</p><p>Votre compte est cr\u00e9\u00e9 et pr\u00eat \u00e0 l\'emploi !</p><p>Avec le plan <strong>Starter gratuit</strong>, vous pouvez g\u00e9n\u00e9rer jusqu\u00e0 <strong>5 devis par mois</strong>.</p><p>Pour des devis illimit\u00e9s et toutes les fonctionnalit\u00e9s pro, passez au plan Pro.</p>',
    ctaLabel: 'Cr\u00e9er mon premier devis \u2192',
    ctaUrl: FRONTEND_URL,
  });
  return sendMail({ to, subject: 'Bienvenue sur Quotly ! \uD83D\uDE80', html });
}

async function sendQuoteEmail({ to, senderName, quoteNumber, pdfBuffer, signatureUrl, userId, quoteId }) {
  const html = htmlTemplate({
    title: 'Votre devis ' + quoteNumber,
    subtitle: senderName + ' vous a envoy\u00e9 un devis via Quotly',
    body: '<p>Bonjour,</p><p>Veuillez trouver ci-joint votre devis <strong>' + quoteNumber + '</strong>.</p><p>Vous pouvez consulter et signer ce devis directement en ligne :</p>',
    ctaLabel: '\u270D\uFE0F Consulter et signer le devis',
    ctaUrl: signatureUrl,
  });
  await sendMail({
    to, subject: 'Devis ' + quoteNumber + ' \u2014 ' + senderName, html,
    attachments: [{ filename: quoteNumber + '.pdf', content: pdfBuffer }],
  });
  db.prepare("INSERT INTO email_logs (id, user_id, quote_id, to_email, subject, status) VALUES (?, ?, ?, ?, ?, 'sent')")
    .run(uuidv4(), userId, quoteId, to, 'Devis ' + quoteNumber);
}

async function sendInvoiceEmail({ to, senderName, invoiceNumber, pdfBuffer, userId, invoiceId }) {
  const html = htmlTemplate({
    title: 'Facture ' + invoiceNumber,
    subtitle: senderName + ' vous a envoy\u00e9 une facture via Quotly',
    body: '<p>Bonjour,</p><p>Veuillez trouver ci-joint votre facture <strong>' + invoiceNumber + '</strong>.</p><p>Merci de proc\u00e9der au r\u00e8glement selon les conditions indiqu\u00e9es.</p>',
    ctaLabel: null, ctaUrl: null,
  });
  await sendMail({
    to, subject: 'Facture ' + invoiceNumber + ' \u2014 ' + senderName, html,
    attachments: [{ filename: invoiceNumber + '.pdf', content: pdfBuffer }],
  });
  db.prepare("INSERT INTO email_logs (id, user_id, invoice_id, to_email, subject, status) VALUES (?, ?, ?, ?, ?, 'sent')")
    .run(uuidv4(), userId, invoiceId, to, 'Facture ' + invoiceNumber);
}

async function sendSignatureNotification({ to, senderName, quoteNumber, signerName }) {
  const html = htmlTemplate({
    title: '\u2705 Devis ' + quoteNumber + ' accept\u00e9 !',
    subtitle: signerName + ' vient de signer votre devis',
    body: '<p>Bonne nouvelle ! Votre devis <strong>' + quoteNumber + '</strong> a \u00e9t\u00e9 sign\u00e9 par <strong>' + signerName + '</strong>.</p><p>Connectez-vous \u00e0 votre espace Quotly pour le convertir en facture en un clic.</p>',
    ctaLabel: 'Voir le devis sign\u00e9', ctaUrl: FRONTEND_URL,
  });
  return sendMail({ to, subject: '\u2705 Devis ' + quoteNumber + ' sign\u00e9 par ' + signerName, html });
}

module.exports = { sendQuoteEmail, sendInvoiceEmail, sendWelcomeEmail, sendSignatureNotification };
