'use strict';
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Tous les templates disponibles
const TEMPLATES = {
  classique:   { primary:'#2d4a2d', text:'#ffffff', accent:'#4a7c4a' },
  minimal:     { primary:'#222222', text:'#ffffff', accent:'#555555' },
  bold:        { primary:'#111111', text:'#ffffff', accent:'#ff3c00' },
  blue_corp:   { primary:'#1a3d6b', text:'#ffffff', accent:'#2e6dc1' },
  artisan:     { primary:'#7c4b2a', text:'#ffffff', accent:'#c47a3a' },
  tech:        { primary:'#0f0f1a', text:'#7b7fff', accent:'#7b7fff' },
  nature:      { primary:'#3a5c3a', text:'#e8f5e2', accent:'#5a8c5a' },
  luxe:        { primary:'#1a1a1a', text:'#c9a84c', accent:'#c9a84c' },
  sante:       { primary:'#1565a0', text:'#ffffff', accent:'#1976d2' },
  immobilier:  { primary:'#2c3e50', text:'#ecf0f1', accent:'#34495e' },
  event:       { primary:'#8b1a6b', text:'#ffffff', accent:'#c0397a' },
  restaurant:  { primary:'#8b2e0c', text:'#fdf3e7', accent:'#c0451a' },
  auto:        { primary:'#2c2c2c', text:'#e63946', accent:'#e63946' },
  beaute:      { primary:'#f7c5d5', text:'#7b2d4e', accent:'#c4718e' },
  juridique:   { primary:'#5c0a14', text:'#f5e6d3', accent:'#8b2030' },
  archi:       { primary:'#e8e4de', text:'#2c2c2c', accent:'#8c8275' },
  photo:       { primary:'#1a1a1a', text:'#ffffff', accent:'#ffffff' },
  transport:   { primary:'#003380', text:'#ff6b00', accent:'#ff6b00' },
  formation:   { primary:'#1976d2', text:'#ffffff', accent:'#42a5f5' },
  nettoyage:   { primary:'#0097a7', text:'#ffffff', accent:'#00bcd4' },
  it:          { primary:'#0d1117', text:'#39d353', accent:'#39d353' },
  mode:        { primary:'#d4bfa0', text:'#3c2415', accent:'#a08060' },
};

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

function computeTotals(items, tvaRate) {
  const totalHT = items.reduce((sum, item) => {
    return sum + (parseFloat(item.qty) || parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0);
  }, 0);
  const tva = totalHT * (tvaRate / 100);
  const totalTTC = totalHT + tva;
  return { totalHT, tva, totalTTC };
}

// ✅ Formatage monétaire sans caractères corrompus (pas de Intl, PDFKit ne supporte pas)
function fmtEuro(amount) {
  const n = parseFloat(amount) || 0;
  const parts = n.toFixed(2).split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${intPart},${parts[1]} EUR`;
}

// Version courte pour colonnes étroites
function fmtEuroShort(amount) {
  return `${parseFloat(amount || 0).toFixed(2)} EUR`;
}

function generatePDF(docData, settings = {}, type = 'quote') {
  return new Promise((resolve, reject) => {
    // ✅ Encoding UTF-8 forcé, police Helvetica intégrée (pas de problème d'encodage)
    const pdf = new PDFDocument({
      margin: 50,
      size: 'A4',
      info: {
        Title: docData.number || 'Devis',
        Author: settings.company_name || docData.company_name || 'Quotly',
        Subject: type === 'quote' ? 'Devis' : 'Facture',
        Creator: 'Quotly',
      },
    });

    const chunks = [];
    pdf.on('data', chunk => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const templateId = (docData.template_id || settings.template_id || 'classique').toLowerCase();
    const tmpl = TEMPLATES[templateId] || TEMPLATES.classique;
    const [pr, pg, pb] = hexToRgb(tmpl.primary);
    const [tr, tg, tb] = hexToRgb(tmpl.text);
    const [ar, ag, ab] = hexToRgb(tmpl.accent);

    const items = typeof docData.items === 'string' ? JSON.parse(docData.items) : (docData.items || []);
    const tvaRate = parseFloat(docData.tva_rate) || 20;
    const { totalHT, tva, totalTTC } = computeTotals(items, tvaRate);

    const isQuote = type === 'quote';
    const docLabel = isQuote ? 'DEVIS' : 'FACTURE';
    const docNumber = docData.number || 'DOC-0001';
    const PAGE_W = pdf.page.width;
    const PAGE_H = pdf.page.height;
    const MARGIN = 50;
    const CONTENT_W = PAGE_W - MARGIN * 2;

    // ── HEADER ────────────────────────────────────────────────────────────────
    pdf.rect(0, 0, PAGE_W, 120).fill(tmpl.primary);

    // Logo ou nom entreprise
    const logoPath = settings.logo_path;
    if (logoPath && fs.existsSync(logoPath)) {
      try {
        pdf.image(logoPath, MARGIN, 20, { height: 60, fit: [180, 60] });
      } catch (_) {
        pdf.fillColor(tmpl.text).fontSize(20).font('Helvetica-Bold')
          .text(settings.company_name || docData.company_name || 'Entreprise', MARGIN, 35);
      }
    } else {
      const companyName = settings.company_name || docData.company_name || 'Votre Entreprise';
      pdf.fillColor(tmpl.text).fontSize(20).font('Helvetica-Bold')
        .text(companyName, MARGIN, 35, { width: 240 });
    }

    // Type de document + numéro (côté droit)
    pdf.fillColor(tmpl.text)
      .fontSize(26).font('Helvetica-Bold')
      .text(docLabel, 0, 28, { align: 'right', width: PAGE_W - MARGIN });
    pdf.fontSize(12).font('Helvetica')
      .text(`N${String.fromCharCode(176)} ${docNumber}`, 0, 60, { align: 'right', width: PAGE_W - MARGIN });

    // Ligne accent
    pdf.rect(0, 120, PAGE_W, 3).fill(tmpl.accent);

    // ── INFOS EMETTEUR / CLIENT ───────────────────────────────────────────────
    let y = 145;
    pdf.fillColor('#555555').fontSize(8).font('Helvetica').text('DE :', MARGIN, y);
    pdf.fillColor('#111111').fontSize(11).font('Helvetica-Bold')
      .text(settings.company_name || docData.company_name || '', MARGIN, y + 13, { width: 230 });

    pdf.font('Helvetica').fontSize(9).fillColor('#444444');
    let yLeft = y + 27;
    if (settings.company_address) {
      pdf.text(settings.company_address, MARGIN, yLeft, { width: 230 });
      yLeft = pdf.y + 3;
    }
    if (settings.company_phone) {
      pdf.text(`Tel : ${settings.company_phone}`, MARGIN, yLeft, { width: 230 });
      yLeft = pdf.y + 3;
    }
    if (settings.company_email) {
      pdf.text(settings.company_email, MARGIN, yLeft, { width: 230 });
      yLeft = pdf.y + 3;
    }
    if (settings.siret) {
      pdf.text(`SIRET : ${settings.siret}`, MARGIN, yLeft, { width: 230 });
    }

    // Client
    const clientX = MARGIN + CONTENT_W / 2 + 10;
    pdf.fillColor('#555555').fontSize(8).font('Helvetica').text('POUR :', clientX, y);
    pdf.fillColor('#111111').fontSize(11).font('Helvetica-Bold')
      .text(docData.client_name || '', clientX, y + 13, { width: 220 });
    pdf.font('Helvetica').fontSize(9).fillColor('#444444');
    let yRight = y + 27;
    if (docData.client_address) {
      pdf.text(docData.client_address, clientX, yRight, { width: 220 });
      yRight = pdf.y + 3;
    }
    if (docData.client_email) {
      pdf.text(docData.client_email, clientX, yRight, { width: 220 });
    }

    // ── BANDEAU MÉTA ──────────────────────────────────────────────────────────
    y = 265;
    const created = new Date(docData.created_at || Date.now()).toLocaleDateString('fr-FR');
    const validity = `${docData.validity_days || docData.due_days || 30} jours`;
    const status = (docData.status || 'draft').toUpperCase();

    pdf.rect(MARGIN, y, CONTENT_W, 28).fill('#f5f5f5');
    const metaCols = [[isQuote ? 'DATE EMISSION' : 'DATE', created], ['VALIDITE', validity], ['STATUT', status]];
    const metaColW = CONTENT_W / 3;
    metaCols.forEach(([label, val], i) => {
      const x = MARGIN + i * metaColW;
      pdf.fillColor('#888888').fontSize(7).font('Helvetica').text(label, x + 8, y + 5, { width: metaColW - 16 });
      pdf.fillColor('#111111').fontSize(9).font('Helvetica-Bold').text(val, x + 8, y + 15, { width: metaColW - 16 });
    });

    // ── TABLEAU DES PRESTATIONS ───────────────────────────────────────────────
    y = 313;

    // ✅ Largeurs de colonnes recalculées pour éviter les chevauchements
    // Désignation | Qté | PU HT | Total HT
    const COL_DESC  = CONTENT_W * 0.48;  // 48% pour la désignation
    const COL_QTE   = CONTENT_W * 0.10;  // 10% pour la quantité
    const COL_PU    = CONTENT_W * 0.21;  // 21% pour le prix unitaire
    const COL_TOTAL = CONTENT_W * 0.21;  // 21% pour le total
    const colWidths = [COL_DESC, COL_QTE, COL_PU, COL_TOTAL];

    // En-tête du tableau
    pdf.rect(MARGIN, y, CONTENT_W, 22).fill(tmpl.primary);
    pdf.fillColor(tmpl.text).fontSize(8).font('Helvetica-Bold');

    let cx = MARGIN + 6;
    // Désignation (aligné à gauche)
    pdf.text('DESIGNATION', cx, y + 7, { width: COL_DESC - 6 });
    cx += COL_DESC;
    // Qté (centré)
    pdf.text('QTE', cx, y + 7, { width: COL_QTE, align: 'center' });
    cx += COL_QTE;
    // PU HT (aligné à droite)
    pdf.text('PU HT', cx, y + 7, { width: COL_PU - 6, align: 'right' });
    cx += COL_PU;
    // Total HT (aligné à droite)
    pdf.text('TOTAL HT', cx, y + 7, { width: COL_TOTAL - 6, align: 'right' });

    y += 22;

    // Lignes du tableau
    items.forEach((item, idx) => {
      const qty = parseFloat(item.qty) || parseFloat(item.quantity) || 0;
      const unitPrice = parseFloat(item.unit_price) || 0;
      const lineTotal = qty * unitPrice;

      // Hauteur de ligne dynamique selon longueur description
      const desc = (item.description || '').trim() || '-';
      const descLines = Math.max(1, Math.ceil(desc.length / 45));
      const rowH = Math.max(22, descLines * 12 + 10);

      // Fond alterné
      if (idx % 2 === 1) {
        pdf.rect(MARGIN, y, CONTENT_W, rowH).fill('#f9f9f9');
      }

      pdf.fillColor('#111111').font('Helvetica').fontSize(9);

      cx = MARGIN + 6;
      // Désignation
      pdf.text(desc, cx, y + 6, { width: COL_DESC - 10, lineGap: 2 });
      cx += COL_DESC;
      // Qté (centré)
      pdf.text(qty % 1 === 0 ? String(qty | 0) : qty.toFixed(2), cx, y + 6, { width: COL_QTE, align: 'center' });
      cx += COL_QTE;
      // PU HT (droite) — ✅ format sans caractère corrompu
      pdf.text(fmtEuroShort(unitPrice), cx, y + 6, { width: COL_PU - 6, align: 'right' });
      cx += COL_PU;
      // Total HT (droite)
      pdf.text(fmtEuroShort(lineTotal), cx, y + 6, { width: COL_TOTAL - 6, align: 'right' });

      // Ligne séparatrice
      pdf.moveTo(MARGIN, y + rowH).lineTo(MARGIN + CONTENT_W, y + rowH)
        .strokeColor('#e0e0e0').lineWidth(0.4).stroke();

      y += rowH;
    });

    // ── TOTAUX ────────────────────────────────────────────────────────────────
    y += 14;
    const totalsX = MARGIN + CONTENT_W * 0.52;
    const totalsW = CONTENT_W * 0.48;

    const drawTotalRow = (label, value, isHighlight = false) => {
      if (isHighlight) {
        pdf.rect(totalsX - 6, y - 3, totalsW + 10, 24).fill(tmpl.primary);
        pdf.fillColor(tmpl.text).font('Helvetica-Bold').fontSize(11);
      } else {
        pdf.fillColor('#333333').font('Helvetica').fontSize(9);
      }
      pdf.text(label, totalsX, y, { width: totalsW * 0.55 });
      pdf.font(isHighlight ? 'Helvetica-Bold' : 'Helvetica')
        .text(value, totalsX + totalsW * 0.55, y, { width: totalsW * 0.45 - 6, align: 'right' });
      pdf.fillColor('#000000');
      y += isHighlight ? 26 : 18;
    };

    // Ligne de séparation
    pdf.moveTo(totalsX - 6, y - 4).lineTo(MARGIN + CONTENT_W + 4, y - 4)
      .strokeColor('#e0e0e0').lineWidth(0.4).stroke();

    drawTotalRow('Total HT', fmtEuro(totalHT));
    drawTotalRow(`TVA (${tvaRate}%)`, fmtEuro(tva));
    drawTotalRow('TOTAL TTC', fmtEuro(totalTTC), true);

    // ── CONDITIONS ────────────────────────────────────────────────────────────
    if (docData.conditions && docData.conditions.trim()) {
      y += 18;
      pdf.fillColor('#888888').fontSize(8).font('Helvetica-Bold').text('CONDITIONS DE PAIEMENT', MARGIN, y);
      y += 12;
      pdf.fillColor('#555555').font('Helvetica').fontSize(9)
        .text(docData.conditions.trim(), MARGIN, y, { width: CONTENT_W });
      y = pdf.y + 10;
    }

    // ── SIGNATURE ─────────────────────────────────────────────────────────────
    if (isQuote && docData.signature_data) {
      y += 10;
      if (y > PAGE_H - 120) {
        pdf.addPage();
        y = MARGIN;
      }
      pdf.fillColor('#888888').fontSize(8).font('Helvetica-Bold').text('SIGNATURE CLIENT', MARGIN, y);
      try {
        const sigB64 = docData.signature_data.replace(/^data:image\/\w+;base64,/, '');
        const sigBuffer = Buffer.from(sigB64, 'base64');
        pdf.image(sigBuffer, MARGIN, y + 12, { height: 60, fit: [200, 60] });
      } catch (_) {}
      if (docData.signed_at) {
        const signedDate = new Date(docData.signed_at).toLocaleString('fr-FR');
        pdf.fillColor('#888888').fontSize(7).font('Helvetica')
          .text(`Signe le ${signedDate}`, MARGIN, y + 76);
      }
    }

    // ── FOOTER ────────────────────────────────────────────────────────────────
    pdf.rect(0, PAGE_H - 38, PAGE_W, 38).fill(tmpl.primary);
    const footerText = [
      'Document genere par Quotly',
      settings.company_name ? `| ${settings.company_name}` : '',
      settings.siret ? `| SIRET ${settings.siret}` : '',
    ].filter(Boolean).join(' ');

    pdf.fillColor(tmpl.text).fontSize(7).font('Helvetica')
      .text(footerText, 0, PAGE_H - 24, { align: 'center', width: PAGE_W });

    pdf.end();
  });
}

module.exports = { generatePDF, computeTotals };
