const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSV = path.join(ROOT, 'data', 'labels.csv');
const OUT = path.join(ROOT, 'etiquetas_correios');

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && quoted && n === '"') {
      cell += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && n === '\n') i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function readRows() {
  const parsed = parseCsv(fs.readFileSync(CSV, 'utf8').replace(/^\uFEFF/, ''));
  const headers = parsed[0];
  return parsed.slice(1).map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] || ''])));
}

function clean(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
}

function pdfEscape(text) {
  return clean(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrap(text, max) {
  const words = clean(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= max) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function barcodeValues(text) {
  const values = [104];
  for (const ch of String(text)) values.push(ch.charCodeAt(0) - 32);
  let checksum = values[0];
  for (let i = 1; i < values.length; i++) checksum += values[i] * i;
  values.push(checksum % 103, 106);
  return values;
}

const PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
];

function barcodeCmd(text, x, y, width, height) {
  const values = barcodeValues(text);
  const modules = values.reduce((sum, value) => sum + PATTERNS[value].split('').reduce((a, b) => a + Number(b), 0), 0);
  const unit = width / modules;
  let cur = x;
  const cmds = [];
  for (const value of values) {
    const pattern = PATTERNS[value];
    for (let i = 0; i < pattern.length; i++) {
      const w = Number(pattern[i]) * unit;
      if (i % 2 === 0) cmds.push(`${cur.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${height.toFixed(2)} re f`);
      cur += w;
    }
  }
  return cmds.join('\n');
}

function text(x, y, size, value, bold = false) {
  return `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfEscape(value)}) Tj ET`;
}

function line(x1, y1, x2, y2, w = 1) {
  return `${w} w ${x1} ${y1} m ${x2} ${y2} l S`;
}

function rect(x, y, w, h, fill = false) {
  return `${x} ${y} ${w} ${h} re ${fill ? 'f' : 'S'}`;
}

function savePdf(file, commands) {
  const objects = [];
  const add = (body) => (objects.push(body), objects.length);
  const content = commands.join('\n');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const stream = add(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`);
  const page = add(`<< /Type /Page /Parent 5 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${stream} 0 R >>`);
  add(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  const catalog = add('<< /Type /Catalog /Pages 5 0 R >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  fs.writeFileSync(file, pdf, 'binary');
}

function destLines(row) {
  return [
    row.destinatario,
    [row.logradouro_destino, row.numero_destino, row.complemento_destino].filter(Boolean).join(', '),
    row.bairro_destino,
    `${row.cep_destino} ${row.cidade_destino}/${row.uf_destino}`,
  ].filter(Boolean).flatMap((v) => wrap(v, 48));
}

function remLines(row) {
  return [
    row.remetente,
    [row.logradouro_remetente, row.numero_remetente, row.complemento_remetente].filter(Boolean).join(', '),
    row.bairro_remetente,
    `${row.cep_remetente} ${row.cidade_remetente}/${row.uf_remetente}`,
  ].filter(Boolean).flatMap((v) => wrap(v, 64));
}

function gerarPdf(row, file) {
  const x = 55, y = 250, w = 420, h = 545;
  const cmds = ['0 0 0 rg 0 0 0 RG', rect(x, y, w, h)];
  cmds.push('0.91 0.02 0.12 rg', rect(x + 18, y + h - 56, 78, 31, true), '1 1 1 rg');
  cmds.push(text(x + 23, y + h - 38, 8, 'Carrefour', true), text(x + 23, y + h - 48, 6, 'marketplace', true), '0 0 0 rg');
  cmds.push(text(x + 310, y + h - 62, 42, 'UX.', true), text(x + 185, y + h - 45, 30, 'S', true));
  cmds.push(text(x + 15, y + h - 102, 12, 'Nota:'), text(x + 75, y + h - 102, 12, row.nota || '-'));
  cmds.push(text(x + 295, y + h - 102, 12, 'Serie:'), text(x + 360, y + h - 102, 12, row.serie || '-'));
  cmds.push(text(x + 15, y + h - 122, 12, 'PLP:'), text(x + 75, y + h - 122, 12, row.plp || '-'));
  cmds.push(text(x + 295, y + h - 122, 12, 'Volume:'), text(x + 360, y + h - 122, 12, '1/1'));
  cmds.push(text(x + 15, y + h - 148, 12, 'Pedido:'), text(x + 75, y + h - 148, 12, `${row.pedido} UXL`, true));
  cmds.push(text(x + 295, y + h - 143, 12, 'Peso'), text(x + 295, y + h - 158, 12, '(kg):'), text(x + 360, y + h - 158, 12, row.peso_kg || ''));
  cmds.push(text(x + 120, y + h - 180, 13, row.codigo_barras, true));
  cmds.push(barcodeCmd(row.codigo_barras, x + 28, y + h - 250, 240, 52));
  ['XX  XX', 'XX  XX', 'XX  XX', 'VD  XX'].forEach((v, i) => cmds.push(text(x + 315, y + h - 200 - i * 20, 12, v, true)));
  cmds.push(text(x + 15, y + h - 278, 12, 'Recebedor:'), line(x + 90, y + h - 280, x + 408, y + h - 280));
  cmds.push(text(x + 15, y + h - 298, 12, 'Assinatura:'), line(x + 90, y + h - 300, x + 240, y + h - 300), text(x + 245, y + h - 298, 12, 'Documento:'), line(x + 325, y + h - 300, x + 408, y + h - 300));
  cmds.push(line(x, y + 215, x + w, y + 215), '0 0 0 rg', rect(x + 2, y + 198, 110, 17, true), '1 1 1 rg', text(x + 4, y + 202, 12, 'DESTINATARIO', true), '0 0 0 rg');
  destLines(row).slice(0, 4).forEach((v, i) => cmds.push(text(x + 12, y + 181 - i * 17, 12, v)));
  cmds.push(text(x + 12, y + 107, 10, 'Obs:'), line(x, y + 101, x + w, y + 101));
  cmds.push('0 0 0 rg', rect(x + 2, y + 84, 92, 17, true), '1 1 1 rg', text(x + 4, y + 88, 12, 'REMETENTE', true), '0 0 0 rg');
  remLines(row).slice(0, 5).forEach((v, i) => cmds.push(text(x + 12, y + 68 - i * 12, 8, v)));
  cmds.push(line(x, y + 12, x + w, y + 12));
  savePdf(file, cmds);
}

function zplText(value) {
  return clean(value).replace(/\^/g, '').replace(/~/g, '');
}

function gerarZpl(row, file) {
  const dest = destLines(row).map(zplText);
  const rem = remLines(row).map(zplText);
  const zpl = [
    '^XA', '^CI28', '^PW812', '^LL1218', '^FO40,40^GB720,900,3^FS',
    '^FO70,80^GB130,55,55^FS', '^FO78,95^FR^A0N,22,22^FDCarrefour^FS', '^FO78,118^FR^A0N,18,18^FDmarketplace^FS',
    '^FO575,75^A0N,70,70^FDUX.^FS',
    `^FO70,190^A0N,28,28^FDNota: ${zplText(row.nota || '-')}^FS`,
    `^FO520,190^A0N,28,28^FDSerie: ${zplText(row.serie || '-')}^FS`,
    `^FO70,225^A0N,28,28^FDPLP: ${zplText(row.plp || '-')}^FS`,
    '^FO520,225^A0N,28,28^FDVolume: 1/1^FS',
    `^FO70,270^A0N,28,28^FDPedido: ${zplText(row.pedido)} UXL^FS`,
    `^FO520,270^A0N,28,28^FDPeso (kg): ${zplText(row.peso_kg)}^FS`,
    `^FO250,315^A0N,28,28^FD${row.codigo_barras}^FS`,
    `^FO90,350^BCN,95,Y,N,N^FD${row.codigo_barras}^FS`,
    '^FO620,345^A0N,28,28^FDXX  XX^FS', '^FO620,380^A0N,28,28^FDXX  XX^FS', '^FO620,415^A0N,28,28^FDXX  XX^FS', '^FO620,450^A0N,28,28^FDVD  XX^FS',
    '^FO70,510^A0N,28,28^FDRecebedor:____________________________^FS',
    '^FO70,545^A0N,28,28^FDAssinatura:____________ Documento:__________^FS',
    '^FO40,590^GB720,3,3^FS', '^FO45,598^GB185,32,32^FS', '^FO50,603^FR^A0N,26,26^FDDESTINATARIO^FS',
    ...dest.slice(0, 4).map((v, i) => `^FO70,${645 + i * 32}^A0N,26,26^FD${v}^FS`),
    '^FO70,790^A0N,22,22^FDObs:^FS', '^FO40,815^GB720,3,3^FS', '^FO45,823^GB160,32,32^FS', '^FO50,828^FR^A0N,24,24^FDREMETENTE^FS',
    ...rem.slice(0, 5).map((v, i) => `^FO70,${870 + i * 22}^A0N,19,19^FD${v}^FS`),
    '^FO40,975^GB720,3,3^FS', '^XZ',
  ].join('\n');
  fs.writeFileSync(file, zpl, 'utf8');
}

fs.mkdirSync(OUT, { recursive: true });
for (const row of readRows()) {
  const safe = row.pedido.replace(/[^a-zA-Z0-9_-]/g, '_');
  gerarPdf(row, path.join(OUT, `etiqueta_${safe}.pdf`));
  gerarZpl(row, path.join(OUT, `etiqueta_${safe}.zpl`));
}
console.log('Etiquetas geradas.');
