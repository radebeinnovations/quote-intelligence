import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unzipSync, zipSync } from "fflate";

async function generateSampleQuote() {
  const sourcePath = resolve("candidate-pack/sample-quotes/Nightjar_Quote_AwardsDinner.xlsx");
  const targetPath = resolve("Test_Quote_Protea_Events.xlsx");

  const bytes = await readFile(sourcePath);
  const archive = unzipSync(new Uint8Array(bytes));
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  // Replace shared strings if present
  if (archive["xl/sharedStrings.xml"]) {
    let xml = decoder.decode(archive["xl/sharedStrings.xml"]);
    xml = xml.replace(/Nightjar Events/g, "Protea Event Logistics");
    xml = xml.replace(/NJ-Q-2025-01/g, "PEL-Q-2026-999");
    xml = xml.replace(/15 Aug 2025/g, "31 Jul 2026");
    archive["xl/sharedStrings.xml"] = encoder.encode(xml);
  }

  const modifiedBytes = zipSync(archive);
  await writeFile(targetPath, modifiedBytes);
  console.log(`Generated new sample quote file at: ${targetPath}`);
}

generateSampleQuote().catch(console.error);
