import fs from 'node:fs';
import { resolve } from 'node:path';
import { parsePdfQuoteBufferFast } from '../apps/api/src/pdf-fast-parser.js';

const pdfPath = resolve('candidate-pack/sample-quotes/Quote_100_Atlas_Logistics.pdf');
const buffer = fs.readFileSync(pdfPath);

console.log('Parsing...');
const start = Date.now();
const result = parsePdfQuoteBufferFast(buffer);
const end = Date.now();

console.log(`Parsed in ${end - start}ms`);
console.log(result ? 'Success' : 'Failed');
