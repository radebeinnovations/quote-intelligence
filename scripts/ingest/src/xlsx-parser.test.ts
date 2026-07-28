import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSouthAfricanDate } from "./date";
import { parseXlsxQuote } from "./xlsx-parser";

const quoteDirectory = fileURLToPath(
  new URL("../../../candidate-pack/sample-quotes/", import.meta.url)
);

describe("sample XLSX corpus", () => {
  it("parses every spreadsheet with valid core fields and arithmetic", async () => {
    const filenames = (await readdir(quoteDirectory))
      .filter((filename) => filename.endsWith(".xlsx"))
      .sort();

    expect(filenames).toHaveLength(10);
    for (const filename of filenames) {
      const document = await parseXlsxQuote(join(quoteDirectory, filename));
      expect(document.supplier.name).not.toBe("");
      expect(document.quote.quoteNumber).not.toBe("");
      expect(parseSouthAfricanDate(document.quote.dateText)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(document.lineItems.length).toBeGreaterThan(0);
      for (const line of document.lineItems) {
        expect(line.quantity * line.unitRate).toBeCloseTo(line.lineTotal, 2);
      }
    }
  });
});
