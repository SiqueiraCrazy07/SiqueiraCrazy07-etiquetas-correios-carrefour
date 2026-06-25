const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const csvPath = path.join(dataDir, 'labels.csv');
const oldDir = path.join(root, 'etiquetas_correios');
const newDir = path.join(root, '9983');

const encoded = fs.readFileSync(path.join(dataDir, 'labels.csv.b64'), 'utf8').replace(/\s+/g, '');
fs.writeFileSync(csvPath, Buffer.from(encoded, 'base64'));

require('./gerar_etiquetas_publicas.cjs');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
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
  const parsed = parseCsv(fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, ''));
  const headers = parsed[0];
  return parsed.slice(1).map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] || ''])));
}

fs.mkdirSync(newDir, { recursive: true });
for (const row of readRows()) {
  const safe = row.pedido.replace(/[^a-zA-Z0-9_-]/g, '_');
  const hash = crypto.createHash('md5').update(`${row.pedido}|${row.sro}|${row.codigo_barras}`).digest('hex');
  fs.copyFileSync(path.join(oldDir, `etiqueta_${safe}.pdf`), path.join(newDir, `${hash}.pdf`));
  fs.copyFileSync(path.join(oldDir, `etiqueta_${safe}.zpl`), path.join(newDir, `${hash}.zpl`));
}

console.log('Etiquetas publicas hash geradas.');
