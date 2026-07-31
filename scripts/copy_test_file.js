import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";

async function copySampleFile() {
  const source = resolve("candidate-pack/sample-quotes/Nightjar_Quote_AwardsDinner.xlsx");
  const target = resolve("SAMPLE_QUOTE_TO_TEST.xlsx");
  await copyFile(source, target);
  console.log("Copied test file to:", target);
}

copySampleFile().catch(console.error);
