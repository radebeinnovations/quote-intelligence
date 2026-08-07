import { writeFileSync, existsSync, mkdirSync } from "node:fs";
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

const NEW_PDF_QUOTES = [
  {
    filename: "Quote_100_Atlas_Logistics.pdf",
    supplier: "Atlas Logistics & Trucking",
    quoteNo: "ATL-2026-100",
    date: "08 August 2026",
    vatNumber: "4112233445",
    lineItems: [
      { desc: "10-ton refrigerated truck", qty: 250, unit: "km", rate: 22.50, total: 5625.00 },
      { desc: "Driver & Assistant", qty: 1, unit: "day", rate: 1200.00, total: 1200.00 }
    ],
    subtotal: 6825.00,
    vat: 1023.75,
    total: 7848.75
  },
  {
    filename: "Quote_101_Mega_Structures.pdf",
    supplier: "Mega Structures Event Roofing",
    quoteNo: "MS-Q-890",
    date: "10 August 2026",
    vatNumber: "4556677889",
    lineItems: [
      { desc: "20x30m Clear Span Marquee", qty: 1, unit: "item", rate: 45000.00, total: 45000.00 },
      { desc: "Rigging and Setup Crew", qty: 40, unit: "hour", rate: 150.00, total: 6000.00 }
    ],
    subtotal: 51000.00,
    vat: 7650.00,
    total: 58650.00
  },
  {
    filename: "Quote_102_Oasis_Plumbing.pdf",
    supplier: "Oasis Mobile Sanitation",
    quoteNo: "OMS-102",
    date: "11 August 2026",
    vatNumber: "4998877665",
    lineItems: [
      { desc: "VIP Restroom Trailer", qty: 3, unit: "item", rate: 3500.00, total: 10500.00 },
      { desc: "Standard Portable Toilet", qty: 20, unit: "item", rate: 350.00, total: 7000.00 },
      { desc: "On-site attendant", qty: 1, unit: "shift", rate: 850.00, total: 850.00 }
    ],
    subtotal: 18350.00,
    vat: 2752.50,
    total: 21102.50
  },
  {
    filename: "Quote_103_Volt_Generators.pdf",
    supplier: "Volt Power Solutions",
    quoteNo: "VP-2026-90",
    date: "12 August 2026",
    vatNumber: "4223344556",
    lineItems: [
      { desc: "100kVA Whisper Silent Generator", qty: 2, unit: "item", rate: 4500.00, total: 9000.00 },
      { desc: "Diesel Fuel (per Liter)", qty: 200, unit: "liter", rate: 22.00, total: 4400.00 }
    ],
    subtotal: 13400.00,
    vat: 2010.00,
    total: 15410.00
  },
  {
    filename: "Quote_104_Apex_Medics.pdf",
    supplier: "Apex Medical Responders",
    quoteNo: "AMR-Q-45",
    date: "13 August 2026",
    vatNumber: "4111222333",
    lineItems: [
      { desc: "Basic Life Support Ambulance", qty: 1, unit: "shift", rate: 4500.00, total: 4500.00 },
      { desc: "Advanced Life Support Paramedic", qty: 2, unit: "shift", rate: 2500.00, total: 5000.00 }
    ],
    subtotal: 9500.00,
    vat: 1425.00,
    total: 10925.00
  },
  {
    filename: "Quote_105_City_Fencing.pdf",
    supplier: "City Barricades & Fencing",
    quoteNo: "CBF-1050",
    date: "14 August 2026",
    vatNumber: "4334455667",
    lineItems: [
      { desc: "Crowd Control Mojo Barrier 1m", qty: 200, unit: "item", rate: 120.00, total: 24000.00 },
      { desc: "Steel Perimeter Fencing (per 2m panel)", qty: 300, unit: "item", rate: 45.00, total: 13500.00 }
    ],
    subtotal: 37500.00,
    vat: 5625.00,
    total: 43125.00
  },
  {
    filename: "Quote_106_Sound_Waves.pdf",
    supplier: "Sound Waves Audio Visual",
    quoteNo: "SW-882",
    date: "15 August 2026",
    vatNumber: "4778899001",
    lineItems: [
      { desc: "Line Array Speaker System", qty: 1, unit: "package", rate: 12000.00, total: 12000.00 },
      { desc: "A1 Audio Engineer", qty: 1, unit: "day", rate: 3500.00, total: 3500.00 },
      { desc: "Wireless Microphone Kit (4 mics)", qty: 2, unit: "kit", rate: 1800.00, total: 3600.00 }
    ],
    subtotal: 19100.00,
    vat: 2865.00,
    total: 21965.00
  },
  {
    filename: "Quote_107_Green_Thumb.pdf",
    supplier: "Green Thumb Plant Hire",
    quoteNo: "GT-2026-11",
    date: "16 August 2026",
    vatNumber: "4889900112",
    lineItems: [
      { desc: "Large Potted Palm Tree", qty: 20, unit: "item", rate: 350.00, total: 7000.00 },
      { desc: "Small Fern Box", qty: 30, unit: "item", rate: 150.00, total: 4500.00 }
    ],
    subtotal: 11500.00,
    vat: 1725.00,
    total: 13225.00
  }
];

const DIR = fileURLToPath(new URL("../candidate-pack/sample-quotes", import.meta.url));
if (!existsSync(DIR)) {
  mkdirSync(DIR, { recursive: true });
}

console.log("Generating 8 new test PDFs...");

for (const quote of NEW_PDF_QUOTES) {
  const buf = createSimplePdf(quote);
  const outPath = resolve(DIR, quote.filename);
  writeFileSync(outPath, buf);
  console.log(`✅ Created PDF: ${quote.filename}`);
}

console.log("\nDone! 8 new test PDFs have been added to candidate-pack/sample-quotes.");
