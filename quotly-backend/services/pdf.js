'use strict';
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

/**
 * Calcule les totaux depuis les lignes JSON
 */
function computeTotals(items, tvaRate) {
  const totalHT = items.reduce((sum, item) => {
    return sum + (parseFloat(item.qty) || 0) * (parseFloat(item.unit_price) || 0);
  }, 0);
  const tva = totalHT * (tvaRate / 100);
  const totalTTC = totalHT + tva;
  return { totalHT, tva, totalTTC };
}

/**
 * Génère un PDF de devis ou facture.
 * @param {object} doc         - devis ou facture depuis la DB
 * @param {object} settings    - paramètres entreprise (logo, couleur…)
 * @param {'quote'|'invoice'}  type
 * @returns {Promise<Buffer>}
 */
function generatePDF(doc, settings = {}, type = 'quote') {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    pdf.on('data', chunk => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const primaryColor = settings.primary_color || '#4f46e5';
    const items = typeof doc.items === 'string' ? JSON.parse(doc.items) : doc.items;
    const { totalHT, tva, totalTTC } = computeTotals(items, doc.tva_rate);

    const isQuote = type === 'quote';
    const docLabel = isQuote ? 'DEVIS' : 'FACTURE';
    const docNumber = doc.number;
    const dateLabel = isQuote ? 'Date d\'émission' : 'Date de facturation';

    // ── En-tête coloré ──────────────────────────────────────────────────────
    pdf.rect(0, 0, pdf.page.width, 120).fill(primaryColor);

    // Logo (si disponible)
    if (settings.logo_path && fs.existsSync(settings.logo_path)) {
      try {
        pdf.image(settings.logo_path, 50, 20, { height: 60, fit: [180, 60] });
      } catch (_) { /* logo corrompu – on ignore */ }
    } else {
      // Nom entreprise en blanc
      pdf.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold')
        .text(settings.company_name || doc.company_name || 'Votre Entreprise', 50, 35);
    }

    // Type de document + numéro
    pdf.fillColor('#ffffff').fontSize(28).font('Helvetica-Bold')
      .text(docLabel, 350, 25, { align: 'right' });
    pdf.fontSize(13).font('Helvetica')
      .text(`N° ${docNumber}`, 350, 60, { align: 'right' });

    pdf.fillColor('#000000');

    // ── Bloc entreprise (gauche) ─────────────────────────────────────────────
    let y = 145;
    pdf.fontSize(9).fillColor('#555555').font('Helvetica')
      .text('DE :', 50, y);
    pdf.fontSize(11).fillColor('#111111').font('Helvetica-Bold')
      .text(settings.company_name || doc.company_name, 50, y + 14);
    pdf.font('Helvetica').fontSize(9).fillColor('#444444');
    if (settings.company_address) pdf.text(settings.company_address, 50, y + 27, { width: 200 });
    if (settings.company_phone)   pdf.text(`Tél : ${settings.company_phone}`, 50, pdf.y + 3);
    if (settings.company_email)   pdf.text(settings.company_email, 50, pdf.y + 3);
    if (settings.siret)           pdf.text(`SIRET : ${settings.siret}`, 50, pdf.y + 3);

    // ── Bloc client (droite) ─────────────────────────────────────────────────
    pdf.fontSize(9).fillColor('#555555').font('Helvetica')
      .text('POUR :', 350, y);
    pdf.fontSize(11).fillColor('#111111').font('Helvetica-Bold')
      .text(doc.client_name, 350, y + 14);
    if (doc.client_address) {
      pdf.font('Helvetica').fontSize(9).fillColor('#444444')
        .text(doc.client_address, 350, y + 27, { width: 200 });
    }
    if (doc.client_email) {
      pdf.text(doc.client_email, 350, pdf.y + 3);
    }

    // ── Méta infos ───────────────────────────────────────────────────────────
    y = 265;
    const created = new Date(doc.created_at).toLocaleDateString('fr-FR');
    const cols = [
      [dateLabel, created],
      isQuote
        ? ['Validité', `${doc.validity_days} jours`]
        : ['Échéance', `${doc.due_days || 30} jours`],
      ['Statut', doc.status.toUpperCase()],
    ];

    pdf.rect(50, y, pdf.page.width - 100, 30).fill('#f5f5f5');
    const colW = (pdf.page.width - 100) / cols.length;
    cols.forEach(([label, value], i) => {
      const x = 50 + i * colW;
      pdf.fillColor('#888').fontSize(8).font('Helvetica').text(label, x + 8, y + 5);
      pdf.fillColor('#111').fontSize(10).font('Helvetica-Bold').text(value, x + 8, y + 16);
    });
    pdf.fillColor('#000000');

    // ── Tableau des prestations ──────────────────────────────────────────────
    y = 315;
    const tableX = 50;
    const tableW = pdf.page.width - 100;
    const colWidths = [tableW * 0.50, 60, 80, 80]; // desc, qté, P.U., total

    // En-tête tableau
    pdf.rect(tableX, y, tableW, 24).fill(primaryColor);
    pdf.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
    const headers = ['Désignation / Description', 'Qté', 'P.U. HT (€)', 'Total HT (€)'];
    let cx = tableX + 8;
    headers.forEach((h, i) => {
      const align = i === 0 ? 'left' : 'right';
      pdf.text(h, cx, y + 7, { width: colWidths[i] - 8, align });
      cx += colWidths[i];
    });

    // Lignes
    y += 24;
    pdf.fillColor('#000000').font('Helvetica').fontSize(9);
    items.forEach((item, idx) => {
      const rowH = 24;
      if (idx % 2 === 1) pdf.rect(tableX, y, tableW, rowH).fill('#fafafa');
      const qty       = parseFloat(item.qty)        || 0;
      const unitPrice = parseFloat(item.unit_price)  || 0;
      const lineTotal = qty * unitPrice;

      pdf.fillColor('#111');
      cx = tableX + 8;
      const cells = [
        item.description || '—',
        qty.toString(),
        unitPrice.toFixed(2),
        lineTotal.toFixed(2),
      ];
      cells.forEach((cell, i) => {
        const align = i === 0 ? 'left' : 'right';
        pdf.text(cell, cx, y + 7, { width: colWidths[i] - 8, align });
        cx += colWidths[i];
      });

      // Ligne de séparation
      pdf.moveTo(tableX, y + rowH).lineTo(tableX + tableW, y + rowH)
        .strokeColor('#e0e0e0').lineWidth(0.5).stroke();
      y += rowH;
    });

    // ── Totaux ───────────────────────────────────────────────────────────────
    y += 16;
    const totalsX = tableX + tableW * 0.55;
    const totalsW = tableW * 0.45;

    const drawTotal = (label, value, bold = false, highlight = false) => {
      if (highlight) {
        pdf.rect(totalsX - 8, y - 4, totalsW + 16, 24).fill(primaryColor);
        pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11);
      } else {
        pdf.fillColor('#333').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      }
      pdf.text(label, totalsX, y, { width: totalsW * 0.55 });
      pdf.text(value, totalsX + totalsW * 0.55, y, { width: totalsW * 0.45, align: 'right' });
      pdf.fillColor('#000');
      y += highlight ? 26 : 18;
    };

    drawTotal('Total HT', `${totalHT.toFixed(2)} €`);
    drawTotal(`TVA (${doc.tva_rate}%)`, `${tva.toFixed(2)} €`);
    drawTotal('TOTAL TTC', `${totalTTC.toFixed(2)} €`, true, true);

    // ── Conditions ───────────────────────────────────────────────────────────
    if (doc.conditions) {
      y += 20;
      pdf.fontSize(8).fillColor('#888').font('Helvetica-Bold').text('CONDITIONS', tableX, y);
      pdf.font('Helvetica').fillColor('#555')
        .text(doc.conditions, tableX, y + 12, { width: tableW, align: 'left' });
      y = pdf.y + 10;
    }

    // ── Signature (si accepté) ───────────────────────────────────────────────
    if (isQuote && doc.signature_data) {
      y += 10;
      pdf.fontSize(8).fillColor('#888').font('Helvetica-Bold')
        .text('SIGNATURE CLIENT', tableX, y);
      try {
        const sigBuffer = Buffer.from(doc.signature_data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        pdf.image(sigBuffer, tableX, y + 14, { height: 60, fit: [200, 60] });
      } catch (_) {}
      if (doc.accepted_at) {
        pdf.fontSize(7).fillColor('#888').font('Helvetica')
          .text(`Signé le ${new Date(doc.accepted_at).toLocaleString('fr-FR')}`, tableX, y + 78);
      }
    }

    // ── Pied de page ─────────────────────────────────────────────────────────
    const pageH = pdf.page.height;
    pdf.rect(0, pageH - 40, pdf.page.width, 40).fill('#f0f0f0');
    pdf.fillColor('#999').fontSize(7).font('Helvetica')
      .text(
        `Document généré par Quotly · ${settings.company_name || ''} · ${settings.siret ? 'SIRET ' + settings.siret : ''}`,
        0, pageH - 26, { align: 'center', width: pdf.page.width }
      );

    pdf.end();
  });
}

module.exports = { generatePDF, computeTotals };
