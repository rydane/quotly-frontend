'use strict';
const PDFDocument = require('pdfkit');
const fs = require('fs');

const TEMPLATES = {
  classic:    { primary:'#2d4a2d', text:'#ffffff', accent:'#4a7c4a' },
  minimal:    { primary:'#222222', text:'#ffffff', accent:'#555555' },
  bold:       { primary:'#111111', text:'#ffffff', accent:'#ff3c00' },
  blue_corp:  { primary:'#1a3d6b', text:'#ffffff', accent:'#2e6dc1' },
  artisan:    { primary:'#7c4b2a', text:'#ffffff', accent:'#c47a3a' },
  tech:       { primary:'#0f0f1a', text:'#7b7fff', accent:'#7b7fff' },
  nature:     { primary:'#3a5c3a', text:'#e8f5e2', accent:'#5a8c5a' },
  luxe:       { primary:'#1a1a1a', text:'#c9a84c', accent:'#c9a84c' },
  sante:      { primary:'#1565a0', text:'#ffffff', accent:'#1976d2' },
  immobilier: { primary:'#2c3e50', text:'#ecf0f1', accent:'#34495e' },
  event:      { primary:'#8b1a6b', text:'#ffffff', accent:'#c0397a' },
  restaurant: { primary:'#8b2e0c', text:'#fdf3e7', accent:'#c0451a' },
  auto:       { primary:'#2c2c2c', text:'#e63946', accent:'#e63946' },
  beaute:     { primary:'#f7c5d5', text:'#7b2d4e', accent:'#c4718e' },
  juridique:  { primary:'#5c0a14', text:'#f5e6d3', accent:'#8b2030' },
  archi:      { primary:'#e8e4de', text:'#2c2c2c', accent:'#8c8275' },
  photo:      { primary:'#1a1a1a', text:'#ffffff', accent:'#ffffff' },
  transport:  { primary:'#003380', text:'#ff6b00', accent:'#ff6b00' },
  formation:  { primary:'#1976d2', text:'#ffffff', accent:'#42a5f5' },
  nettoyage:  { primary:'#0097a7', text:'#ffffff', accent:'#00bcd4' },
  it:         { primary:'#0d1117', text:'#39d353', accent:'#39d353' },
  mode:       { primary:'#d4bfa0', text:'#3c2415', accent:'#a08060' },
};

function hexToRgb(hex) {
  hex = hex.replace('#','');
  if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
  const n = parseInt(hex, 16);
  return [n>>16&255, n>>8&255, n&255];
}

function computeTotals(items, tvaRate) {
  const totalHT = items.reduce((sum, item) => {
    return sum + (parseFloat(item.qty) || parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0);
  }, 0);
  const tva = totalHT * (tvaRate / 100);
  const totalTTC = totalHT + tva;
  return { totalHT, tva, totalTTC };
}

function generatePDF(docData, settings = {}, type = 'quote') {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    pdf.on('data', chunk => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const templateId = docData.template_id || settings.template_id || 'classic';
    const tmpl = TEMPLATES[templateId] || TEMPLATES.classic;
    const [pr, pg, pb] = hexToRgb(tmpl.primary);
    const [tr, tg, tb] = hexToRgb(tmpl.text);
    const [ar, ag, ab] = hexToRgb(tmpl.accent);

    const items = typeof docData.items === 'string' ? JSON.parse(docData.items) : docData.items;
    const { totalHT, tva, totalTTC } = computeTotals(items, docData.tva_rate);

    const isQuote = type === 'quote';
    const docLabel = isQuote ? 'DEVIS' : 'FACTURE';
    const docNumber = docData.number;

    // Header
    pdf.rect(0, 0, pdf.page.width, 120).fill(tmpl.primary);

    if (settings.logo_path && fs.existsSync(settings.logo_path)) {
      try { pdf.image(settings.logo_path, 50, 20, { height: 60, fit: [180, 60] }); } catch (_) {}
    } else {
      pdf.fillColor(tmpl.text).fontSize(22).font('Helvetica-Bold')
        .text(settings.company_name || docData.company_name || 'Votre Entreprise', 50, 35);
    }

    pdf.fillColor(tmpl.text).fontSize(28).font('Helvetica-Bold').text(docLabel, 350, 25, { align: 'right' });
    pdf.fontSize(13).font('Helvetica').text(`N° ${docNumber}`, 350, 60, { align: 'right' });

    // Accent line
    pdf.rect(0, 120, pdf.page.width, 3).fill(tmpl.accent);

    pdf.fillColor('#000000');

    // Bloc entreprise
    let y = 145;
    pdf.fontSize(9).fillColor('#555555').font('Helvetica').text('DE :', 50, y);
    pdf.fontSize(11).fillColor('#111111').font('Helvetica-Bold').text(settings.company_name || docData.company_name, 50, y + 14);
    pdf.font('Helvetica').fontSize(9).fillColor('#444444');
    if (settings.company_address) pdf.text(settings.company_address, 50, y + 27, { width: 200 });
    if (settings.company_phone)   pdf.text(`Tél : ${settings.company_phone}`, 50, pdf.y + 3);
    if (settings.company_email)   pdf.text(settings.company_email, 50, pdf.y + 3);
    if (settings.siret)           pdf.text(`SIRET : ${settings.siret}`, 50, pdf.y + 3);

    // Bloc client
    pdf.fontSize(9).fillColor('#555555').font('Helvetica').text('POUR :', 350, y);
    pdf.fontSize(11).fillColor('#111111').font('Helvetica-Bold').text(docData.client_name, 350, y + 14);
    if (docData.client_address) pdf.font('Helvetica').fontSize(9).fillColor('#444444').text(docData.client_address, 350, y + 27, { width: 200 });
    if (docData.client_email)   pdf.text(docData.client_email, 350, pdf.y + 3);

    // Méta infos
    y = 265;
    const created = new Date(docData.created_at || Date.now()).toLocaleDateString('fr-FR');
    const cols = [
      [isQuote ? 'Date émission' : 'Date facturation', created],
      [isQuote ? 'Validité' : 'Échéance', `${docData.validity_days || docData.due_days || 30} jours`],
      ['Statut', (docData.status || 'draft').toUpperCase()],
    ];
    pdf.rect(50, y, pdf.page.width - 100, 30).fill('#f5f5f5');
    const colW = (pdf.page.width - 100) / cols.length;
    cols.forEach(([label, value], i) => {
      const x = 50 + i * colW;
      pdf.fillColor('#888').fontSize(8).font('Helvetica').text(label, x + 8, y + 5);
      pdf.fillColor('#111').fontSize(10).font('Helvetica-Bold').text(value, x + 8, y + 16);
    });

    // Tableau
    y = 315;
    const tableX = 50, tableW = pdf.page.width - 100;
    const colWidths = [tableW * 0.50, 60, 80, 80];

    pdf.rect(tableX, y, tableW, 24).fill(tmpl.primary);
    pdf.fillColor(tmpl.text).fontSize(9).font('Helvetica-Bold');
    const headers = ['Désignation / Description', 'Qté', 'P.U. HT (€)', 'Total HT (€)'];
    let cx = tableX + 8;
    headers.forEach((h, i) => {
      pdf.text(h, cx, y + 7, { width: colWidths[i] - 8, align: i === 0 ? 'left' : 'right' });
      cx += colWidths[i];
    });

    y += 24;
    pdf.fillColor('#000000').font('Helvetica').fontSize(9);
    items.forEach((item, idx) => {
      const rowH = 24;
      if (idx % 2 === 1) pdf.rect(tableX, y, tableW, rowH).fill('#fafafa');
      const qty = parseFloat(item.qty) || parseFloat(item.quantity) || 0;
      const unitPrice = parseFloat(item.unit_price) || 0;
      const lineTotal = qty * unitPrice;
      pdf.fillColor('#111');
      cx = tableX + 8;
      [item.description || '—', qty.toString(), unitPrice.toFixed(2), lineTotal.toFixed(2)].forEach((cell, i) => {
        pdf.text(cell, cx, y + 7, { width: colWidths[i] - 8, align: i === 0 ? 'left' : 'right' });
        cx += colWidths[i];
      });
      pdf.moveTo(tableX, y + rowH).lineTo(tableX + tableW, y + rowH).strokeColor('#e0e0e0').lineWidth(0.5).stroke();
      y += rowH;
    });

    // Totaux
    y += 16;
    const totalsX = tableX + tableW * 0.55;
    const totalsW = tableW * 0.45;
    const drawTotal = (label, value, bold, highlight) => {
      if (highlight) {
        pdf.rect(totalsX - 8, y - 4, totalsW + 16, 24).fill(tmpl.primary);
        pdf.fillColor(tmpl.text).font('Helvetica-Bold').fontSize(11);
      } else {
        pdf.fillColor('#333').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      }
      pdf.text(label, totalsX, y, { width: totalsW * 0.55 });
      pdf.text(value, totalsX + totalsW * 0.55, y, { width: totalsW * 0.45, align: 'right' });
      pdf.fillColor('#000');
      y += highlight ? 26 : 18;
    };
    drawTotal('Total HT', `${totalHT.toFixed(2)} €`);
    drawTotal(`TVA (${docData.tva_rate}%)`, `${tva.toFixed(2)} €`);
    drawTotal('TOTAL TTC', `${totalTTC.toFixed(2)} €`, true, true);

    // Conditions
    if (docData.conditions) {
      y += 20;
      pdf.fontSize(8).fillColor('#888').font('Helvetica-Bold').text('CONDITIONS', tableX, y);
      pdf.font('Helvetica').fillColor('#555').text(docData.conditions, tableX, y + 12, { width: tableW });
      y = pdf.y + 10;
    }

    // Signature
    if (isQuote && docData.signature_data) {
      y += 10;
      pdf.fontSize(8).fillColor('#888').font('Helvetica-Bold').text('SIGNATURE CLIENT', tableX, y);
      try {
        const sigBuffer = Buffer.from(docData.signature_data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        pdf.image(sigBuffer, tableX, y + 14, { height: 60, fit: [200, 60] });
      } catch (_) {}
      if (docData.accepted_at) {
        pdf.fontSize(7).fillColor('#888').font('Helvetica')
          .text(`Signé le ${new Date(docData.accepted_at).toLocaleString('fr-FR')}`, tableX, y + 78);
      }
    }

    // Footer
    const pageH = pdf.page.height;
    pdf.rect(0, pageH - 40, pdf.page.width, 40).fill(tmpl.primary);
    pdf.fillColor(tmpl.text).fontSize(7).font('Helvetica')
      .text(`Document généré par Quotly · ${settings.company_name || ''} · ${settings.siret ? 'SIRET ' + settings.siret : ''}`,
        0, pageH - 26, { align: 'center', width: pdf.page.width });

    pdf.end();
  });
}

module.exports = { generatePDF, computeTotals };
