import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";

const TEST_QUOTES = [
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

export function generate5TestQuotesSync(baseDir = ".") {
  const sourcePath = resolve(baseDir, "candidate-pack/sample-quotes/Nightjar_Quote_AwardsDinner.xlsx");
  if (!existsSync(sourcePath)) {
    console.error("Base source file not found at:", sourcePath);
    return;
  }

  const bytes = readFileSync(sourcePath);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  for (const item of TEST_QUOTES) {
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
    console.log(`Generated test quote file: ${item.filename}`);
  }
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntryPoint) generate5TestQuotesSync(process.cwd());
