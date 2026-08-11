import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// --- PDF Generator ---
function createSimplePdf(quote) {
  const contentLines = [
    "BT",
    "/F1 18 Tf",
    "50 740 Td",
    `(${escapePdfText(quote.supplier)}) Tj`,
    "ET",
    "BT",
    "/F2 10 Tf",
    "50 710 Td",
    `(${escapePdfText("TAX INVOICE / QUOTATION")}) Tj`,
    "0 -18 Td",
    `(${escapePdfText(`Quote Number: ${quote.quoteNo}`)}) Tj`,
    "0 -14 Td",
    `(${escapePdfText(`Date: ${quote.date}`)}) Tj`,
    "0 -14 Td",
    `(${escapePdfText(`VAT Number: ${quote.vatNumber}`)}) Tj`,
    "0 -14 Td",
    `(${escapePdfText("Currency: ZAR")}) Tj`,
    "0 -25 Td",
    `(${escapePdfText("--------------------------------------------------------------------------------------------------")}) Tj`,
    "0 -18 Td",
    "/F1 10 Tf",
    `(${escapePdfText("Description                                          Qty     Unit          Rate (ZAR)     Total (ZAR)")}) Tj`,
    "ET",
    "BT",
    "/F2 10 Tf",
    "50 580 Td"
  ];

  let currentY = 580;
  for (const line of quote.lineItems) {
    const qty = String(line.qty).padEnd(6);
    const unit = String(line.unit).padEnd(12);
    const rate = String(line.rate.toFixed(2)).padStart(12);
    const total = String(line.total.toFixed(2)).padStart(14);
    const desc = line.desc.padEnd(48);

    contentLines.push(`(${escapePdfText(`${desc} ${qty} ${unit} ${rate} ${total}`)}) Tj`);
    contentLines.push("0 -16 Td");
    currentY -= 16;
  }

  contentLines.push("0 -15 Td");
  contentLines.push(`(${escapePdfText("--------------------------------------------------------------------------------------------------")}) Tj`);
  contentLines.push("0 -20 Td");
  contentLines.push(`(${escapePdfText(`Subtotal (Excl VAT): R ${quote.subtotal.toFixed(2)}`)}) Tj`);
  contentLines.push("0 -14 Td");
  contentLines.push(`(${escapePdfText(`VAT (15%): R ${quote.vat.toFixed(2)}`)}) Tj`);
  contentLines.push("0 -16 Td");
  contentLines.push("/F1 11 Tf");
  contentLines.push(`(${escapePdfText(`Total (Incl VAT): R ${quote.total.toFixed(2)}`)}) Tj`);
  contentLines.push("ET");

  const streamText = contentLines.join("\n");
  const streamLength = Buffer.byteLength(streamText, "ascii");

  const pdfBody = [
    "%PDF-1.4",
    "1 0 obj",
    "<</Type /Catalog /Pages 2 0 R>>",
    "endobj",
    "2 0 obj",
    "<</Type /Pages /Kids [3 0 R] /Count 1>>",
    "endobj",
    "3 0 obj",
    "<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</Font <</F1 4 0 R /F2 5 0 R>>>> /Contents 6 0 R>>",
    "endobj",
    "4 0 obj",
    "<</Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold>>",
    "endobj",
    "5 0 obj",
    "<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>",
    "endobj",
    "6 0 obj",
    `<</Length ${streamLength}>>`,
    "stream",
    streamText,
    "endstream",
    "endobj"
  ];

  let offset = 0;
  const offsets = [0];
  const bodyText = [];

  for (const item of pdfBody) {
    if (item.endsWith("obj") && !item.startsWith("end")) {
      offsets.push(offset);
    }
    bodyText.push(item);
    offset += Buffer.byteLength(item + "\n", "ascii");
  }

  const xrefStart = offset;
  const xref = [
    "xref",
    `0 ${offsets.length}`,
    "0000000000 65535 f "
  ];
  for (let i = 1; i < offsets.length; i++) {
    xref.push(`${String(offsets[i]).padStart(10, "0")} 00000 n `);
  }

  const trailer = [
    "trailer",
    `<</Size ${offsets.length} /Root 1 0 R>>`,
    "startxref",
    String(xrefStart),
    "%%EOF"
  ];

  return Buffer.from([...bodyText, ...xref, ...trailer].join("\n"), "ascii");
}

function escapePdfText(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// --- Quote Definitions ---
const PDF_QUOTES = [
  {
    filename: "School_Logistics_Quote_1.pdf",
    supplier: "School Logistics",
    quoteNo: "SL-2026-001",
    date: "10 August 2026",
    vatNumber: "0111119999",
    lineItems: [
      { desc: "32-Seater School Bus (per day)", qty: 2, unit: "item-day", rate: 2500.00, total: 5000.00 },
      { desc: "Driver & Assistant Fee", qty: 2, unit: "person-day", rate: 850.00, total: 1700.00 }
    ],
    subtotal: 6700.00,
    vat: 1005.00,
    total: 7705.00
  },
  {
    filename: "School_Logistics_Quote_2.pdf",
    supplier: "School Logistics",
    quoteNo: "SL-2026-002",
    date: "12 August 2026",
    vatNumber: "0111119999",
    lineItems: [
      { desc: "16-Seater Minibus (per km)", qty: 150, unit: "km", rate: 12.50, total: 1875.00 },
      { desc: "Luggage Trailer Hire", qty: 1, unit: "item-day", rate: 450.00, total: 450.00 }
    ],
    subtotal: 2325.00,
    vat: 348.75,
    total: 2673.75
  },
  {
    filename: "School_Logistics_Quote_3.pdf",
    supplier: "School Logistics",
    quoteNo: "SL-2026-003",
    date: "15 August 2026",
    vatNumber: "0111119999",
    lineItems: [
      { desc: "60-Seater Luxury Coach (per day)", qty: 1, unit: "item-day", rate: 5800.00, total: 5800.00 },
      { desc: "Toll Gate & Permit Surcharge", qty: 1, unit: "lump-sum", rate: 450.00, total: 450.00 }
    ],
    subtotal: 6250.00,
    vat: 937.50,
    total: 7187.50
  }
];

export function generateQuotes(baseDir = ".") {
  for (const quote of PDF_QUOTES) {
    const pdfBuffer = createSimplePdf(quote);
    const targetPath = resolve(baseDir, quote.filename);
    writeFileSync(targetPath, pdfBuffer);
    console.log(`Generated PDF test quote: ${quote.filename}`);
  }
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntryPoint) generateQuotes(process.cwd());
