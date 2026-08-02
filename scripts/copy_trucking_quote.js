import { copyFile, existsSync } from "node:fs";
import { resolve } from "node:path";

function copyTruckingPDFs() {
  const root = ".";
  const source = resolve(root, "candidate-pack/sample-quotes/TTL-Q35.pdf");
  const target = resolve(root, "1_TON_TRUCKING_QUOTE_TO_UPLOAD.pdf");
  if (existsSync(source)) {
    copyFile(source, target, (err) => {
      if (err) console.error(err);
      else console.log("Copied 1-ton trucking quote PDF to:", target);
    });
  }
}

copyTruckingPDFs();
