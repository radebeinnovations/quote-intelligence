import { createServiceDatabaseClient } from "@quote-intelligence/database";
import type {
  IngestionRunAudit,
  StatsResponse,
  SupplierAnalytics,
  UploadQuoteResponse
} from "@quote-intelligence/domain";
import { createHash, randomUUID } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server";

const integrationEnabled = process.env.RUN_SUPABASE_INTEGRATION === "1";
const integrationSuite = integrationEnabled ? describe : describe.skip;

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function inlineCell(reference: string, value: string): string {
  return `<c r="${reference}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
}

function numberCell(reference: string, value: number): string {
  return `<c r="${reference}"><v>${value}</v></c>`;
}

function row(number: number, cells: string): string {
  return `<row r="${number}">${cells}</row>`;
}

function proteaEventsWorkbook(supplierName: string, quoteNumber: string): Buffer {
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${row(1, inlineCell("A1", supplierName))}
    ${row(2, inlineCell("A2", "Quote no:") + inlineCell("B2", quoteNumber))}
    ${row(3, inlineCell("A3", "Date:") + inlineCell("B3", "31/07/2026"))}
    ${row(4, inlineCell("A4", "VAT no:") + inlineCell("B4", `VAT-${quoteNumber}`))}
    ${row(5, inlineCell("A5", "Event:") + inlineCell("B5", "Protea Events integration test"))}
    ${row(7,
      inlineCell("A7", "Description") + inlineCell("B7", "Qty") +
      inlineCell("C7", "Unit") + inlineCell("D7", "Unit Rate") +
      inlineCell("E7", "Line Total"))}
    ${row(8,
      inlineCell("A8", "Waiter per hour") + numberCell("B8", 2) +
      inlineCell("C8", "hour") + numberCell("D8", 100) + numberCell("E8", 200))}
    ${row(9,
      inlineCell("A9", "Custom protea floral installation") + numberCell("B9", 1) +
      inlineCell("C9", "each") + numberCell("D9", 500) + numberCell("E9", 500))}
    ${row(10, inlineCell("A10", "Subtotal") + numberCell("E10", 700))}
    ${row(11, inlineCell("A11", "VAT @ 15%") + numberCell("E11", 105))}
    ${row(12, inlineCell("A12", "Total (incl. VAT)") + numberCell("E12", 805))}
  </sheetData>
</worksheet>`;
  return Buffer.from(zipSync({
    "xl/worksheets/sheet1.xml": strToU8(worksheet)
  }));
}

function multipartUpload(filename: string, contents: Buffer): {
  boundary: string;
  payload: Buffer;
} {
  const boundary = `quote-intelligence-${randomUUID()}`;
  return {
    boundary,
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"
      ),
      contents,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ])
  };
}

integrationSuite("quote upload metric integration", () => {
  const database = integrationEnabled ? createServiceDatabaseClient() : null;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it("updates stats and creates a parsed SHA-256 audit entry after XLSX ingestion", async () => {
    const suffix = randomUUID();
    const supplierName = `Protea Events Integration ${suffix}`;
    const quoteNumber = `PE-${suffix}`;
    const filename = `Test_Quote_Protea_Events_${suffix}.xlsx`;
    const workbook = proteaEventsWorkbook(supplierName, quoteNumber);
    const sha256 = createHash("sha256").update(workbook).digest("hex");
    if (!database) throw new Error("Integration database client is unavailable.");

    const { error: migrationError } = await database
      .from("suppliers")
      .select("active")
      .limit(1);
    if (migrationError) {
      throw new Error(
        "The configured Supabase project is missing migration 202607310002_supplier_soft_delete.sql. Apply migrations before running this integration suite."
      );
    }

    const initialStatsResponse = await app.inject({ method: "GET", url: "/api/stats" });
    expect(initialStatsResponse.statusCode, initialStatsResponse.body).toBe(200);
    const initialStats = initialStatsResponse.json<StatsResponse>();
    expect(initialStats).toEqual(expect.objectContaining({
      totalQuotes: expect.any(Number),
      totalSuppliers: expect.any(Number),
      catalogItemCount: expect.any(Number),
      totalLineItems: expect.any(Number)
    }));

    const initialSuppliersResponse = await app.inject({ method: "GET", url: "/api/suppliers" });
    expect(initialSuppliersResponse.statusCode).toBe(200);
    const initialSupplierIds = new Set(
      initialSuppliersResponse.json<SupplierAnalytics[]>().map(({ supplierId }) => supplierId)
    );
    const { data: initialCatalog, error: initialCatalogError } = await database
      .from("catalog_items")
      .select("id,name");
    if (initialCatalogError) throw initialCatalogError;
    const initialCatalogNames = new Set(
      (initialCatalog ?? []).map(({ name }) => name as string)
    );
    const initialCatalogIds = new Set(
      (initialCatalog ?? []).map(({ id }) => id as string)
    );

    const multipart = multipartUpload(filename, workbook);
    let upload: UploadQuoteResponse | null = null;
    try {
      const uploadResponse = await app.inject({
        method: "POST",
        url: "/api/ingest/upload",
        headers: { "content-type": `multipart/form-data; boundary=${multipart.boundary}` },
        payload: multipart.payload
      });
      expect([200, 201], uploadResponse.body).toContain(uploadResponse.statusCode);
      upload = uploadResponse.json<UploadQuoteResponse>();
      expect(upload.sha256).toBe(sha256);
      expect(upload.supplier.name).toBe(supplierName);
      expect(upload.lineItems).toHaveLength(2);
      expect(upload.lineItems.every(({ description }) => description.length > 0)).toBe(true);

      const updatedStatsResponse = await app.inject({ method: "GET", url: "/api/stats" });
      expect(updatedStatsResponse.statusCode, updatedStatsResponse.body).toBe(200);
      const updatedStats = updatedStatsResponse.json<StatsResponse>();
      expect(updatedStats.totalQuotes).toBe(initialStats.totalQuotes + 1);
      expect(updatedStats.totalLineItems).toBe(
        initialStats.totalLineItems + upload.lineItems.length
      );
      const expectedSupplierDelta = initialSupplierIds.has(upload.supplier.id) ? 0 : 1;
      expect(updatedStats.totalSuppliers).toBe(
        initialStats.totalSuppliers + expectedSupplierDelta
      );

      const createdCatalogNames = new Set(
        upload.lineItems.flatMap(({ match }) =>
          match.catalogItemName && !initialCatalogNames.has(match.catalogItemName)
            ? [match.catalogItemName]
            : []
        )
      );
      expect(updatedStats.catalogItemCount).toBe(
        initialStats.catalogItemCount + createdCatalogNames.size
      );

      const auditResponse = await app.inject({ method: "GET", url: "/api/ingestion-runs" });
      expect(auditResponse.statusCode, auditResponse.body).toBe(200);
      const audit = auditResponse.json<IngestionRunAudit[]>();
      const auditRun = audit.find((run) =>
        run.documents.some((document) => document.sha256 === sha256)
      );
      expect(auditRun).toBeDefined();
      expect(auditRun?.status).toBe("completed");
      expect(auditRun?.documents).toContainEqual(expect.objectContaining({
        filename,
        sha256,
        status: "parsed"
      }));
    } finally {
      const { data: source, error: sourceError } = await database
        .from("source_documents")
        .select("id,ingestion_run_id")
        .eq("sha256", sha256)
        .maybeSingle<{ id: string; ingestion_run_id: string }>();
      if (sourceError) throw sourceError;
      if (!source) return;

      const { data: quote, error: quoteError } = await database
        .from("quotes")
        .select("id,supplier_id")
        .eq("source_document_id", source.id)
        .maybeSingle<{ id: string; supplier_id: string }>();
      if (quoteError) throw quoteError;
      const catalogIds = new Set<string>();
      if (quote) {
        const { data: lines, error: lineError } = await database
          .from("quote_line_items")
          .select("id")
          .eq("quote_id", quote.id);
        if (lineError) throw lineError;
        const lineIds = (lines ?? []).map(({ id }) => id as string);
        if (lineIds.length) {
          const { data: matches, error: matchError } = await database
            .from("catalog_matches")
            .select("catalog_item_id")
            .in("line_item_id", lineIds);
          if (matchError) throw matchError;
          for (const match of matches ?? []) {
            const catalogId = match.catalog_item_id as string | null;
            if (catalogId && !initialCatalogIds.has(catalogId)) catalogIds.add(catalogId);
          }
        }
        const { error: deleteQuoteError } = await database.from("quotes").delete().eq("id", quote.id);
        if (deleteQuoteError) throw deleteQuoteError;
        if (!initialSupplierIds.has(quote.supplier_id)) {
          const { error: deleteSupplierError } = await database
            .from("suppliers")
            .delete()
            .eq("id", quote.supplier_id);
          if (deleteSupplierError) throw deleteSupplierError;
        }
      }
      const { error: deleteSourceError } = await database
        .from("source_documents")
        .delete()
        .eq("id", source.id);
      if (deleteSourceError) throw deleteSourceError;
      const { error: deleteRunError } = await database
        .from("ingestion_runs")
        .delete()
        .eq("id", source.ingestion_run_id);
      if (deleteRunError) throw deleteRunError;
      if (catalogIds.size) {
        const { error: deleteCatalogError } = await database
          .from("catalog_items")
          .delete()
          .in("id", [...catalogIds]);
        if (deleteCatalogError) throw deleteCatalogError;
      }
    }
  });
});
