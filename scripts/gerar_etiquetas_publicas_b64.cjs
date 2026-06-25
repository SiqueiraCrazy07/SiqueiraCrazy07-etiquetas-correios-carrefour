const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const inputPath = path.join(dataDir, 'labels.csv.b64');
const outputPath = path.join(dataDir, 'labels.csv');

const encoded = fs.readFileSync(inputPath, 'utf8').replace(/\s+/g, '');
fs.writeFileSync(outputPath, Buffer.from(encoded, 'base64'));

require('./gerar_etiquetas_publicas.cjs');
