import fs from 'node:fs';
import { resolve } from 'node:path';
import { parsePdfQuoteBufferFast } from '../apps/api/src/pdf-fast-parser.js';

try {
  const pdfPath = resolve('School_Logistics_Quote_1.pdf');
  if (!fs.existsSync(pdfPath)) {
    console.log('File does not exist yet. Did the user run the generation script?');
  } else {
    const buffer = fs.readFileSync(pdfPath);
    console.log('Parsing...');
    const result = parsePdfQuoteBufferFast(buffer);
    console.log(JSON.stringify(result, null, 2));
  }
} catch(err) {
  console.error(err);
}
