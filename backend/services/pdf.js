'use strict';
/**
 * DEFACT — Génération PDF (devis & factures) — v3.1 premium
 *
 * Améliorations vs v3.0 :
 *  • Typographie aérée (line-heights, letter-spacing)
 *  • Vraie devise € (Helvetica + WinAnsi le supporte, testé)
 *  • Vraie mention « N° »
 *  • Hiérarchie visuelle nette : 3 zones (en-tête / corps / totaux)
 *  • Totaux mieux placés (alignés au pixel près sur la colonne de droite)
 *  • Style facture vs devis différencié (libellé d'en-tête + date d'échéance)
 *  • Footer minimaliste sur chaque page
 *  • Pagination automatique si beaucoup de lignes
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');

// ─── Templates couleurs ───────────────────────────────────────────────────────
const TEMPLATES = {
  classique:   { primary:'#16775a', text:'#ffffff', accent:'#0f9e70' },
  minimal:     { primary:'#1a1a1a', text:'#ffffff', accent:'#666666' },
  bold:        { primary:'#0f0f0f', text:'#ffffff', accent:'#ff3c00' },
  blue_corp:   { primary:'#1a3d6b', text:'#ffffff', accent:'#2e6dc1' },
  artisan:     { primary:'#7c4b2a', text:'#ffffff', accent:'#c47a3a' },
  tech:        { primary:'#0f0f1a', text:'#ffffff', accent:'#7b7fff' },
  nature:      { primary:'#3a5c3a', text:'#ffffff', accent:'#5a8c5a' },
  luxe:        { primary:'#1a1a1a', text:'#c9a84c', accent:'#c9a84c' },
  sante:       { primary:'#1565a0', text:'#ffffff', accent:'#1976d2' },
  immobilier:  { primary:'#2c3e50', text:'#ffffff', accent:'#34495e' },
  event:       { primary:'#8b1a6b', text:'#ffffff', accent:'#c0397a' },
  restaurant:  { primary:'#8b2e0c', text:'#fdf3e7', accent:'#c0451a' },
  auto:        { primary:'#2c2c2c', text:'#ffffff', accent:'#e63946' },
  beaute:      { primary:'#a8536a', text:'#ffffff', accent:'#c4718e' },
  juridique:   { primary:'#5c0a14', text:'#ffffff', accent:'#8b2030' },
  archi:       { primary:'#2c2c2c', text:'#ffffff', accent:'#8c8275' },
  photo:       { primary:'#1a1a1a', text:'#ffffff', accent:'#888888' },
  transport:   { primary:'#003380', text:'#ffffff', accent:'#ff6b00' },
  formation:   { primary:'#1976d2', text:'#ffffff', accent:'#42a5f5' },
  nettoyage:   { primary:'#0097a7', text:'#ffffff', accent:'#00bcd4' },
  it:          { primary:'#0d1117', text:'#ffffff', accent:'#39d353' },
  mode:        { primary:'#3c2415', text:'#ffffff', accent:'#a08060' },
};

// ─── Utilitaires ──────────────────────────────────────────────────────────────
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

/** Formatage € (Helvetica + WinAnsi gère bien le caractère €, testé) */
function fmtEuro(amount) {
  const n = parseFloat(amount) || 0;
  const parts = n.toFixed(2).split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${intPart},${parts[1]} \u20AC`; // \u20AC = €
}

function fmtEuroShort(amount) {
  const n = parseFloat(amount) || 0;
  return `${n.toFixed(2).replace('.', ',')} \u20AC`;
}

/**
 * Sanitise le texte saisi par l'utilisateur :
 *  - Convertit les guillemets/tirets typographiques en ASCII
 *  - Garde les accents français, €, °
 *  - Supprime les emoji, scripts non-latins
 */
function sanitizeText(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '--')
    .replace(/\u2026/g, '...')
    .replace(/[^\x00-\xFF\u20AC]/g, '')
    .trim();
}

// ─── Génération PDF ───────────────────────────────────────────────────────────
function generatePDF(docData, settings = {}, type = 'quote') {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      margin: 0,
      size: 'A4',
      bufferPages: true, // pour pouvoir ajouter le footer après coup
      info: {
        Title: sanitizeText(docData.number || (type === 'quote' ? 'Devis' : 'Facture')),
        Author: sanitizeText(settings.company_name || docData.company_name || 'DEFACT'),
        Subject: type === 'quote' ? 'Devis' : 'Facture',
        Creator: 'DEFACT',
        Producer: 'DEFACT',
      },
    });

    const chunks = [];
    pdf.on('data', c => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    // ── Constantes layout ─────────────────────────────────────────────────────
    const PAGE_W = pdf.page.width;       // 595 pt
    const PAGE_H = pdf.page.height;      // 842 pt
    const MARGIN = 48;
    const CONTENT_W = PAGE_W - MARGIN * 2;

    const templateId = (docData.template_id || settings.template_id || 'classique').toLowerCase();
    const tmpl = TEMPLATES[templateId] || TEMPLATES.classique;

    const items = typeof docData.items === 'string'
      ? JSON.parse(docData.items)
      : (docData.items || []);
    const tvaRate = parseFloat(docData.tva_rate) || 20;
    const { totalHT, tva, totalTTC } = computeTotals(items, tvaRate);

    const isQuote = type === 'quote';
    const docLabel = isQuote ? 'DEVIS' : 'FACTURE';
    const docNumber = sanitizeText(docData.number || 'DOC-0001');

    // Couleurs sémantiques (palette neutre, lisible sur tout template)
    const COLOR = {
      ink:       '#0f0f0f',
      body:      '#3a3a3a',
      muted:     '#7a7a7a',
      hairline:  '#e8e6e0',
      zebra:     '#fafaf8',
      bg:        '#ffffff',
    };

    // ────────────────────────────────────────────────────────────────────────
    // EN-TÊTE
    // ────────────────────────────────────────────────────────────────────────
    const HEADER_H = 96;
    pdf.rect(0, 0, PAGE_W, HEADER_H).fill(tmpl.primary);

    const logoPath = settings.logo_path;
    let logoUsed = false;
    if (logoPath && fs.existsSync(logoPath)) {
      try {
        pdf.image(logoPath, MARGIN, 24, { height: 48, fit: [180, 48] });
        logoUsed = true;
      } catch (_) {/* fallback texte */}
    }
    if (!logoUsed) {
      pdf.fillColor(tmpl.text)
        .fontSize(20).font('Helvetica-Bold')
        .text(sanitizeText(settings.company_name || docData.company_name || 'DEFACT'),
              MARGIN, 36, { width: 280, lineBreak: false });
    }

    // Libellé doc + numéro
    pdf.fillColor(tmpl.text)
      .fontSize(28).font('Helvetica-Bold')
      .text(docLabel, 0, 30, { align: 'right', width: PAGE_W - MARGIN, characterSpacing: 1.5 });
    pdf.fontSize(11).font('Helvetica')
      .fillColor(tmpl.text)
      .opacity(0.85)
      .text(`N\u00B0 ${docNumber}`, 0, 64, { align: 'right', width: PAGE_W - MARGIN });
    pdf.opacity(1);

    pdf.rect(0, HEADER_H, PAGE_W, 3).fill(tmpl.accent);

    // ────────────────────────────────────────────────────────────────────────
    // ÉMETTEUR / CLIENT
    // ────────────────────────────────────────────────────────────────────────
    let y = HEADER_H + 32;
    const col1X = MARGIN;
    const col2X = MARGIN + CONTENT_W / 2 + 16;
    const colW = CONTENT_W / 2 - 16;

    const drawPartyBlock = (label, x, lines) => {
      pdf.fillColor(COLOR.muted)
        .fontSize(7.5).font('Helvetica-Bold')
        .text(label, x, y, { width: colW, characterSpacing: 1.5 });
      let yy = y + 14;
      lines.forEach((line, i) => {
        if (!line) return;
        pdf.fillColor(i === 0 ? COLOR.ink : COLOR.body)
          .fontSize(i === 0 ? 11 : 9.5)
          .font(i === 0 ? 'Helvetica-Bold' : 'Helvetica')
          .text(sanitizeText(line), x, yy, { width: colW });
        yy = pdf.y + (i === 0 ? 4 : 1);
      });
      return yy;
    };

    const fromLines = [
      settings.company_name || docData.company_name || '',
      settings.company_address || '',
      settings.company_phone ? `T\u00E9l. ${settings.company_phone}` : '',
      settings.company_email || '',
      settings.siret ? `SIRET ${settings.siret}` : '',
    ];
    const toLines = [
      docData.client_name || '',
      docData.client_address || '',
      docData.client_phone ? `T\u00E9l. ${docData.client_phone}` : '',
      docData.client_email || '',
    ];

    const yLeftEnd = drawPartyBlock('\u00C9METTEUR', col1X, fromLines);
    const yRightEnd = drawPartyBlock(isQuote ? 'CLIENT' : 'FACTUR\u00C9 \u00C0', col2X, toLines);
    y = Math.max(yLeftEnd, yRightEnd) + 24;

    // ────────────────────────────────────────────────────────────────────────
    // BANDEAU MÉTADONNÉES
    // ────────────────────────────────────────────────────────────────────────
    const created = new Date(docData.created_at || Date.now()).toLocaleDateString('fr-FR');
    const META_H = 48;

    pdf.rect(MARGIN, y, CONTENT_W, META_H).fill('#fafaf8');
    pdf.lineWidth(0.5).strokeColor(COLOR.hairline)
      .moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).stroke()
      .moveTo(MARGIN, y + META_H).lineTo(MARGIN + CONTENT_W, y + META_H).stroke();

    let metaCols;
    if (isQuote) {
      const validity = `${docData.validity_days || 30} jours`;
      const status = sanitizeText((docData.status || 'draft').replace(/_/g, ' ').toUpperCase());
      metaCols = [
        ['DATE D\'\u00C9MISSION', created],
        ['VALIDIT\u00C9', validity],
        ['STATUT', status],
      ];
    } else {
      const dueDate = docData.due_date
        ? new Date(docData.due_date).toLocaleDateString('fr-FR')
        : (() => {
            const d = new Date(docData.created_at || Date.now());
            d.setDate(d.getDate() + (parseInt(docData.due_days) || 30));
            return d.toLocaleDateString('fr-FR');
          })();
      const status = sanitizeText((docData.status || 'sent').replace(/_/g, ' ').toUpperCase());
      metaCols = [
        ['DATE D\'\u00C9MISSION', created],
        ['DATE D\'\u00C9CH\u00C9ANCE', dueDate],
        ['STATUT', status],
      ];
    }

    const metaColW = CONTENT_W / metaCols.length;
    metaCols.forEach(([label, val], i) => {
      const x = MARGIN + i * metaColW;
      if (i > 0) {
        pdf.lineWidth(0.5).strokeColor(COLOR.hairline)
          .moveTo(x, y + 8).lineTo(x, y + META_H - 8).stroke();
      }
      pdf.fillColor(COLOR.muted)
        .fontSize(7).font('Helvetica-Bold')
        .text(label, x + 14, y + 11, { width: metaColW - 28, characterSpacing: 1.2 });
      pdf.fillColor(COLOR.ink)
        .fontSize(11).font('Helvetica-Bold')
        .text(val, x + 14, y + 25, { width: metaColW - 28 });
    });
    y += META_H + 28;

    // ────────────────────────────────────────────────────────────────────────
    // TABLE DES PRESTATIONS
    // ────────────────────────────────────────────────────────────────────────
    const COL_DESC  = CONTENT_W * 0.50;
    const COL_QTE   = CONTENT_W * 0.10;
    const COL_PU    = CONTENT_W * 0.20;
    const COL_TOTAL = CONTENT_W * 0.20;

    pdf.lineWidth(1).strokeColor(COLOR.ink)
      .moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).stroke();

    pdf.fillColor(COLOR.ink).fontSize(8).font('Helvetica-Bold');
    let cx = MARGIN;
    pdf.text('D\u00C9SIGNATION', cx, y + 8, { width: COL_DESC, characterSpacing: 1.2 });
    cx += COL_DESC;
    pdf.text('QT\u00C9', cx, y + 8, { width: COL_QTE, align: 'center', characterSpacing: 1.2 });
    cx += COL_QTE;
    pdf.text('PU HT', cx, y + 8, { width: COL_PU - 4, align: 'right', characterSpacing: 1.2 });
    cx += COL_PU;
    pdf.text('TOTAL HT', cx, y + 8, { width: COL_TOTAL - 4, align: 'right', characterSpacing: 1.2 });

    y += 26;
    pdf.lineWidth(0.5).strokeColor(COLOR.hairline)
      .moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).stroke();
    y += 4;

    items.forEach((item, idx) => {
      const qty = parseFloat(item.qty) || parseFloat(item.quantity) || 0;
      const unitPrice = parseFloat(item.unit_price) || 0;
      const lineTotal = qty * unitPrice;
      const desc = sanitizeText((item.description || '').trim() || '\u2014');

      pdf.fontSize(10).font('Helvetica');
      const descH = pdf.heightOfString(desc, { width: COL_DESC - 12 });
      const rowH = Math.max(28, descH + 16);

      // Saut de page si dépassement (réserver espace pour totaux + footer)
      if (y + rowH > PAGE_H - 220) {
        pdf.addPage();
        y = MARGIN;
      }

      if (idx % 2 === 1) {
        pdf.rect(MARGIN, y - 2, CONTENT_W, rowH).fill(COLOR.zebra);
      }

      pdf.fillColor(COLOR.ink).fontSize(10).font('Helvetica');
      cx = MARGIN;
      pdf.text(desc, cx + 4, y + 6, { width: COL_DESC - 12, lineGap: 2 });
      cx += COL_DESC;

      pdf.fillColor(COLOR.body);
      const qtyStr = qty % 1 === 0 ? String(qty | 0) : qty.toFixed(2).replace('.', ',');
      pdf.text(qtyStr, cx, y + 6, { width: COL_QTE, align: 'center' });
      cx += COL_QTE;
      pdf.text(fmtEuroShort(unitPrice), cx, y + 6, { width: COL_PU - 4, align: 'right' });
      cx += COL_PU;
      pdf.fillColor(COLOR.ink).font('Helvetica-Bold');
      pdf.text(fmtEuroShort(lineTotal), cx, y + 6, { width: COL_TOTAL - 4, align: 'right' });

      y += rowH;
    });

    pdf.lineWidth(0.5).strokeColor(COLOR.hairline)
      .moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).stroke();

    // ────────────────────────────────────────────────────────────────────────
    // TOTAUX
    // ────────────────────────────────────────────────────────────────────────
    y += 22;
    const totalsW = CONTENT_W * 0.42;
    const totalsX = MARGIN + CONTENT_W - totalsW;

    if (y + 90 > PAGE_H - 80) {
      pdf.addPage();
      y = MARGIN;
    }

    const drawTotalRow = (label, value, opts = {}) => {
      const { highlight = false } = opts;
      if (highlight) {
        pdf.rect(totalsX, y - 6, totalsW, 32).fill(tmpl.primary);
        pdf.fillColor(tmpl.text).font('Helvetica-Bold').fontSize(13);
        pdf.text(label, totalsX + 14, y + 4, { width: totalsW * 0.55 - 14, characterSpacing: 0.5 });
        pdf.text(value, totalsX + totalsW * 0.55, y + 4, { width: totalsW * 0.45 - 14, align: 'right' });
        y += 36;
      } else {
        pdf.fillColor(COLOR.body).font('Helvetica').fontSize(10);
        pdf.text(label, totalsX + 14, y, { width: totalsW * 0.55 - 14 });
        pdf.fillColor(COLOR.ink).font('Helvetica-Bold');
        pdf.text(value, totalsX + totalsW * 0.55, y, { width: totalsW * 0.45 - 14, align: 'right' });
        y += 20;
      }
    };

    drawTotalRow('Sous-total HT', fmtEuro(totalHT));
    drawTotalRow(`TVA (${tvaRate}%)`, fmtEuro(tva));
    y += 4;
    drawTotalRow('TOTAL TTC', fmtEuro(totalTTC), { highlight: true });

    // ────────────────────────────────────────────────────────────────────────
    // CONDITIONS
    // ────────────────────────────────────────────────────────────────────────
    if (docData.conditions && docData.conditions.trim()) {
      y += 28;
      if (y > PAGE_H - 140) { pdf.addPage(); y = MARGIN; }

      pdf.lineWidth(0.5).strokeColor(COLOR.hairline)
        .moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).stroke();
      y += 14;

      pdf.fillColor(COLOR.muted).fontSize(8).font('Helvetica-Bold')
        .text(isQuote ? 'CONDITIONS' : 'CONDITIONS DE PAIEMENT',
              MARGIN, y, { characterSpacing: 1.2 });
      y += 14;
      pdf.fillColor(COLOR.body).font('Helvetica').fontSize(9.5)
        .text(sanitizeText(docData.conditions.trim()),
              MARGIN, y, { width: CONTENT_W, lineGap: 2 });
      y = pdf.y + 8;
    }

    // ────────────────────────────────────────────────────────────────────────
    // SIGNATURE (devis seulement)
    // ────────────────────────────────────────────────────────────────────────
    if (isQuote && docData.signature_data) {
      y += 18;
      if (y > PAGE_H - 160) { pdf.addPage(); y = MARGIN; }

      pdf.lineWidth(0.5).strokeColor(COLOR.hairline)
        .moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).stroke();
      y += 14;

      pdf.fillColor(COLOR.muted).fontSize(8).font('Helvetica-Bold')
        .text('SIGNATURE CLIENT', MARGIN, y, { characterSpacing: 1.2 });

      if (docData.signer_name) {
        pdf.fillColor(COLOR.body).fontSize(9.5).font('Helvetica')
          .text(sanitizeText(docData.signer_name), MARGIN, y + 14);
      }
      try {
        const sigB64 = docData.signature_data.replace(/^data:image\/\w+;base64,/, '');
        const sigBuffer = Buffer.from(sigB64, 'base64');
        pdf.image(sigBuffer, MARGIN, y + 30, { height: 50, fit: [200, 50] });
      } catch (_) {/* image ignorée si invalide */}
      if (docData.signed_at) {
        const signedDate = new Date(docData.signed_at).toLocaleString('fr-FR');
        pdf.fillColor(COLOR.muted).fontSize(7.5).font('Helvetica')
          .text(`Sign\u00E9 le ${signedDate}`, MARGIN, y + 92);
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // FOOTER — sur toutes les pages (grâce à bufferPages)
    // ────────────────────────────────────────────────────────────────────────
    const pageRange = pdf.bufferedPageRange();
    for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
      pdf.switchToPage(i);

      const fy = PAGE_H - 32;
      pdf.lineWidth(0.5).strokeColor(COLOR.hairline)
        .moveTo(MARGIN, fy - 8).lineTo(MARGIN + CONTENT_W, fy - 8).stroke();

      const parts = [
        sanitizeText(settings.company_name || ''),
        settings.siret ? `SIRET ${sanitizeText(settings.siret)}` : '',
        settings.tva_intra ? `TVA ${sanitizeText(settings.tva_intra)}` : '',
      ].filter(Boolean);

      pdf.fillColor(COLOR.muted).fontSize(7.5).font('Helvetica')
        .text(parts.join('  \u2022  '), MARGIN, fy, { width: CONTENT_W, align: 'left' });

      pdf.text('G\u00E9n\u00E9r\u00E9 avec DEFACT  \u2022  defact.fr',
        MARGIN, fy, { width: CONTENT_W, align: 'right' });
    }

    pdf.end();
  });
}

module.exports = { generatePDF, computeTotals, TEMPLATES };
