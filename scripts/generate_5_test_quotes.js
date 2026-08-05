import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";

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

  // Calculate xref offsets
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
    filename: "Test_Quote_6_Vanguard_Security.pdf",
    supplier: "Vanguard Protection & Event Security",
    quoteNo: "VPS-Q-2026-606",
    date: "06 August 2026",
    vatNumber: "4987654306",
    lineItems: [
      { desc: "Day Security Officer (10-hr shift)", qty: 4, unit: "person-hour", rate: 65.00, total: 2600.00 },
      { desc: "Night Security Officer (12-hr shift)", qty: 4, unit: "person-hour", rate: 85.00, total: 4080.00 }
    ],
    subtotal: 6680.00,
    vat: 1002.00,
    total: 7682.00
  },
  {
    filename: "Test_Quote_7_Kalahari_Catering.pdf",
    supplier: "Kalahari Gourmet Catering & Events",
    quoteNo: "KGC-Q-2026-707",
    date: "07 August 2026",
    vatNumber: "4987654307",
    lineItems: [
      { desc: "Executive VIP 3-Course Banquet Meal", qty: 150, unit: "person", rate: 450.00, total: 67500.00 },
      { desc: "Professional Waitstaff Service", qty: 6, unit: "person-hour", rate: 60.00, total: 2880.00 }
    ],
    subtotal: 70380.00,
    vat: 10557.00,
    total: 80937.00
  },
  {
    filename: "Test_Quote_8_Safari_AudioVisual.pdf",
    supplier: "Safari Sound & Lighting Systems",
    quoteNo: "SSL-Q-2026-808",
    date: "08 August 2026",
    vatNumber: "4987654308",
    lineItems: [
      { desc: "50 kVA Sound & Lighting Generator Hire", qty: 1, unit: "item-day", rate: 3800.00, total: 3800.00 },
      { desc: "Senior AV Sound Technician", qty: 2, unit: "person-hour", rate: 180.00, total: 2880.00 }
    ],
    subtotal: 6680.00,
    vat: 1002.00,
    total: 7682.00
  },
  {
    filename: "Test_Quote_9_Protea_Decor.pdf",
    supplier: "Protea Event Decor & Furniture",
    quoteNo: "PED-Q-2026-909",
    date: "09 August 2026",
    vatNumber: "4987654309",
    lineItems: [
      { desc: "White Tiffany Chair Hire", qty: 120, unit: "item-day", rate: 45.00, total: 5400.00 },
      { desc: "1.8 m Trestle Table Hire", qty: 15, unit: "item-day", rate: 55.00, total: 825.00 }
    ],
    subtotal: 6225.00,
    vat: 933.75,
    total: 7158.75
  },
  {
    filename: "Test_Quote_10_TableMountain_Shuttles.pdf",
    supplier: "Table Mountain Express Transport",
    quoteNo: "TME-Q-2026-010",
    date: "10 August 2026",
    vatNumber: "4987654310",
    lineItems: [
      { desc: "22-Seat Passenger Shuttle Bus (per km)", qty: 250, unit: "vehicle-km", rate: 32.00, total: 8000.00 },
      { desc: "8-Ton Freight Logistics Truck (per km)", qty: 180, unit: "vehicle-km", rate: 35.00, total: 6300.00 }
    ],
    subtotal: 14300.00,
    vat: 2145.00,
    total: 16445.00
  }
];

const XLSX_QUOTES = [
  {
    filename: "Test_Quote_1_Zambezi_Logistics.xlsx",
    supplier: "Zambezi Event Logistics",
    quoteNo: "ZEL-Q-2026-101",
    date: "01 August 2026",
    vatNumber: "4123456701"
  },
  {
    filename: "Test_Quote_2_Highveld_Power.xlsx",
    supplier: "Highveld Power & Plant Hire",
    quoteNo: "HPP-Q-2026-202",
    date: "02 August 2026",
    vatNumber: "4123456702"
  },
  {
    filename: "Test_Quote_3_Apex_Stage_Crew.xlsx",
    supplier: "Apex Stage & AV Crew",
    quoteNo: "ASC-Q-2026-303",
    date: "03 August 2026",
    vatNumber: "4123456703"
  },
  {
    filename: "Test_Quote_4_Ubuntu_Catering.xlsx",
    supplier: "Ubuntu Event Catering Co",
    quoteNo: "UEC-Q-2026-404",
    date: "04 August 2026",
    vatNumber: "4123456704"
  },
  {
    filename: "Test_Quote_5_Cape_Shuttles.xlsx",
    supplier: "Cape Express Passenger Shuttles",
    quoteNo: "CPS-Q-2026-505",
    date: "05 August 2026",
    vatNumber: "4123456705"
  }
];

export function generateAllTestQuotesSync(baseDir = ".") {
  const sourcePath = resolve(baseDir, "candidate-pack/sample-quotes/Nightjar_Quote_AwardsDinner.xlsx");

  // 1. Generate PDF Quotes
  for (const quote of PDF_QUOTES) {
    const pdfBuffer = createSimplePdf(quote);
    const targetPath = resolve(baseDir, quote.filename);
    writeFileSync(targetPath, pdfBuffer);
    console.log(`Generated PDF test quote: ${quote.filename}`);
  }

  // 2. Generate XLSX Quotes
  if (existsSync(sourcePath)) {
    const bytes = readFileSync(sourcePath);
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    for (const item of XLSX_QUOTES) {
      const archive = unzipSync(new Uint8Array(bytes));
      for (const [entryName, entryBytes] of Object.entries(archive)) {
        if (!entryName.endsWith(".xml")) continue;

        const xml = decoder
          .decode(entryBytes)
          .replaceAll("Nightjar Events", item.supplier)
          .replaceAll("NJE-25-026", item.quoteNo)
          .replaceAll("15 August 2025", item.date)
          .replaceAll("4340990071", item.vatNumber);
        archive[entryName] = encoder.encode(xml);
      }
      const targetPath = resolve(baseDir, item.filename);
      const modifiedBytes = zipSync(archive);
      writeFileSync(targetPath, modifiedBytes);
      console.log(`Generated XLSX test quote: ${item.filename}`);
    }
  }
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntryPoint) generateAllTestQuotesSync(process.cwd());
