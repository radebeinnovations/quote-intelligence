import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseXlsxQuoteBuffer } from "./xlsx-buffer-parser";

describe("XLSX upload parser", () => {
  it("extracts a supplier quote directly from an uploaded workbook buffer", async () => {
    const buffer = await readFile(new URL(
      "../../../candidate-pack/sample-quotes/SwiftMove_Quotation_2026-06-03.xlsx",
      import.meta.url
    ));

    const document = parseXlsxQuoteBuffer(buffer);

    expect(document.supplier.name).toBe("Swift Move Logistics");
    expect(document.quote.quoteNumber).toBeTruthy();
    expect(document.lineItems.length).toBeGreaterThan(0);
    expect(document.lineItems[0]).toEqual(expect.objectContaining({
      description: expect.any(String),
      quantity: expect.any(Number),
      unitRate: expect.any(Number)
    }));
  });
});
