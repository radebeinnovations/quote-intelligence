import type { ExtractedDocument, TaxBasis } from "@quote-intelligence/domain";
import { extractedDocumentSchema } from "@quote-intelligence/domain";
import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";
import { readFile } from "node:fs/promises";

type CellValue = string | number | boolean | null | undefined;
type XmlRecord = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: false
});

const array = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const record = (value: unknown): XmlRecord =>
  value && typeof value === "object" ? value as XmlRecord : {};

function xmlText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  const object = record(value);
  if ("#text" in object) return String(object["#text"]);
  if ("t" in object) return xmlText(object.t);
  if ("r" in object) {
    return array(object.r).map((part) => xmlText(record(part).t)).join("");
  }
  return "";
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? "A";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function decodeWorkbook(bytes: Uint8Array): CellValue[][] {
  const archive = unzipSync(bytes);
  const decoder = new TextDecoder();
  const sheetBytes = archive["xl/worksheets/sheet1.xml"];
  if (!sheetBytes) throw new Error("Workbook does not contain xl/worksheets/sheet1.xml");

  const sharedBytes = archive["xl/sharedStrings.xml"];
  const sharedStrings = sharedBytes
    ? array(record(record(parser.parse(decoder.decode(sharedBytes))).sst).si).map(xmlText)
    : [];
  const worksheet = record(parser.parse(decoder.decode(sheetBytes))).worksheet;
  const rowsXml = array(record(record(worksheet).sheetData).row);
  const rows: CellValue[][] = [];

  for (const rowValue of rowsXml) {
    const row = record(rowValue);
    const rowNumber = Number(row["@_r"] ?? rows.length + 1);
    const values: CellValue[] = [];
    for (const cellValue of array(row.c)) {
      const cell = record(cellValue);
      const reference = String(cell["@_r"] ?? "A1");
      const type = String(cell["@_t"] ?? "n");
      let value: CellValue;
      if (type === "inlineStr") value = xmlText(record(cell.is).t ?? cell.is);
      else if (type === "s") value = sharedStrings[Number(xmlText(cell.v))] ?? "";
      else if (type === "b") value = xmlText(cell.v) === "1";
      else {
        const raw = xmlText(cell.v);
        value = raw === "" ? null : Number(raw);
      }
      values[columnIndex(reference)] = value;
    }
    rows[rowNumber - 1] = values;
  }
  return Array.from({ length: rows.length }, (_, index) => rows[index] ?? []);
}

function text(value: CellValue): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function number(value: CellValue, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(text(value).replace(/[R,\s]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${text(value)}`);
  return parsed;
}

function valueBesideLabel(rows: CellValue[][], label: string): string | undefined {
  const normalizedLabel = label.toLowerCase();
  for (const row of rows) {
    const index = row.findIndex((cell) => text(cell).toLowerCase() === normalizedLabel);
    if (index >= 0) {
      const value = text(row[index + 1]);
      return value || undefined;
    }
  }
  return undefined;
}

function detectTaxBasis(rows: CellValue[][]): TaxBasis {
  const allText = rows.flat().map(text).join(" ").toLowerCase();
  if (allText.includes("include fuel, driver and vat")) return "inclusive";
  if (allText.includes("all prices include vat")) return "inclusive";
  if (allText.includes("vat @ 15%")) return "exclusive";
  return "unknown";
}

export async function parseXlsxQuote(filePath: string): Promise<ExtractedDocument> {
  const rows = decodeWorkbook(new Uint8Array(await readFile(filePath)));
  const headerIndex = rows.findIndex(
    (row) =>
      text(row[0]).toLowerCase() === "description" &&
      text(row[1]).toLowerCase() === "qty"
  );
  if (headerIndex < 0) throw new Error("Could not find line-item header row");

  const supplierName = text(rows[0]?.[0]);
  const quoteNumber = valueBesideLabel(rows, "Quote no:");
  const dateValue = valueBesideLabel(rows, "Date:");
  if (!supplierName || !quoteNumber || !dateValue) {
    throw new Error("Missing supplier, quote number, or date");
  }

  const lineItems = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const description = text(row[0]);
    if (!description) continue;
    if (["subtotal", "vat", "total"].some((label) => description.toLowerCase().includes(label))) continue;
    if (row[1] === null || row[1] === undefined || !text(row[2])) break;
    lineItems.push({
      sourceRow: String(index + 1),
      description,
      quantity: number(row[1], "quantity"),
      unit: text(row[2]),
      unitRate: number(row[3], "unit rate"),
      lineTotal: number(row[4], "line total")
    });
  }

  const totalLabelRow = rows.find((row) =>
    row.some((cell) => text(cell).toLowerCase().includes("total (incl. vat)"))
  );
  const subtotalRow = rows.find((row) =>
    row.some((cell) => text(cell).toLowerCase() === "subtotal")
  );
  const vatRow = rows.find((row) =>
    row.some((cell) => text(cell).toLowerCase().startsWith("vat @"))
  );
  const taxBasis = detectTaxBasis(rows);

  return extractedDocumentSchema.parse({
    supplier: { name: supplierName, vatNumber: valueBesideLabel(rows, "VAT no:") },
    quote: {
      quoteNumber,
      dateText: dateValue,
      eventName: valueBesideLabel(rows, "Event:"),
      currency: "ZAR",
      vatRate: 0.15,
      taxBasis,
      ...(subtotalRow ? { subtotal: number(subtotalRow[4], "subtotal") } : {}),
      ...(vatRow ? { vatAmount: number(vatRow[4], "VAT") } : {}),
      ...(totalLabelRow ? { total: number(totalLabelRow[4], "total") } : {})
    },
    lineItems,
    notes: rows.flat().map(text).filter((value) => value.startsWith("- "))
  });
}
