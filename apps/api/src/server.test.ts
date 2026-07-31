import type {
  CatalogDetailResponse,
  IngestionRunAudit,
  PaginatedCatalogResponse,
  ReassignLineItemResult,
  StatsResponse,
  SupplierAnalytics,
  UnmatchedLineItemsResponse,
  UploadQuoteResponse
} from "@quote-intelligence/domain";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer, type CatalogApiService } from "./server";
import type { UploadIngestionApi } from "./upload-ingestion-service";

const catalogItemId = "11111111-1111-4111-8111-111111111111";
const lineItemId = "22222222-2222-4222-8222-222222222222";

const catalogPage: PaginatedCatalogResponse = {
  items: [
    {
      id: catalogItemId,
      name: "Waitstaff",
      description: "Canonical staffing service.",
      category: "Staffing",
      primaryUnit: "person-hour",
      linkedLineItemCount: 4,
      supplierCount: 2,
      minPrice: 95,
      maxPrice: 110,
      fairPrice: 102.5
    }
  ],
  page: 1,
  pageSize: 50,
  total: 1,
  totalPages: 1
};

const detailResponse: CatalogDetailResponse = {
  item: {
    id: catalogItemId,
    name: "Waitstaff",
    description: "Canonical staffing service.",
    category: "Staffing",
    primaryUnit: "person-hour",
    pricingBasis: "person-hour",
    attributes: {}
  },
  priceHistory: [
    {
      date: "2026-06-01",
      supplierId: "33333333-3333-4333-8333-333333333333",
      supplierName: "Cape Crew",
      rate: 100,
      rawRate: 115,
      unit: "person-hour",
      total: 920,
      quoteNumber: "CC-100",
      quoteId: "44444444-4444-4444-8444-444444444444",
      estimated: false
    }
  ],
  supplierComparison: [
    {
      supplierId: "33333333-3333-4333-8333-333333333333",
      supplierName: "Cape Crew",
      averageRate: 100,
      minRate: 100,
      maxRate: 100,
      lastQuotedRate: 100,
      lastQuoteDate: "2026-06-01",
      quoteCount: 1,
      primaryUnit: "person-hour"
    }
  ],
  fairPrice: {
    value: 100,
    overallMedian: 100,
    recentMedian: 100,
    mean: 100,
    sampleSize: 1,
    supplierCount: 1,
    method: "median",
    confidence: 0.175,
    excludedCount: 0,
    outlierCount: 0,
    formula: "Median of comparable, current, arithmetically valid ex-VAT rates",
    observations: [
      {
        date: "2026-06-01",
        supplierName: "Cape Crew",
        rate: 100,
        outlier: false
      }
    ]
  },
  linkedLineItems: [
    {
      id: lineItemId,
      description: "Waiter per hour",
      supplierName: "Cape Crew",
      quoteNumber: "CC-100",
      quoteId: "44444444-4444-4444-8444-444444444444",
      date: "2026-06-01",
      quantity: 8,
      rawUnit: "hour",
      rawRate: 115,
      normalizedRate: 100,
      normalizedUnit: "person-hour",
      estimated: false,
      comparable: true,
      arithmeticValid: true,
      taxBasis: "inclusive"
    }
  ]
};

const statsResponse: StatsResponse = {
  totalQuotes: 51,
  totalLineItems: 174,
  catalogItemCount: 37,
  totalSuppliers: 10,
  dateRange: { from: "2025-08-03", to: "2026-07-15" }
};

const unmatchedResponse: UnmatchedLineItemsResponse = {
  items: [],
  total: 0
};

const reassignResponse: ReassignLineItemResult = {
  lineItemId,
  catalogItemId,
  created: false,
  comparable: true,
  canonicalRate: 100,
  canonicalBasis: "person-hour"
};

const suppliersResponse: SupplierAnalytics[] = [];
const ingestionAuditResponse: IngestionRunAudit[] = [];
const uploadResponse: UploadQuoteResponse = {
  idempotent: false,
  sha256: "a".repeat(64),
  filename: "quote.pdf",
  supplier: { id: "55555555-5555-4555-8555-555555555555", name: "Cape Crew" },
  quote: {
    id: "44444444-4444-4444-8444-444444444444",
    quoteNumber: "CC-101",
    quoteDate: "2026-07-31",
    currency: "ZAR",
    total: 920
  },
  lineItems: [{
    id: lineItemId,
    sourceRow: "12",
    description: "Waiter per hour",
    quantity: 8,
    unit: "hour",
    unitRate: 100,
    lineTotal: 800,
    match: {
      catalogItemId,
      catalogItemName: "Waitstaff",
      status: "matched",
      confidence: 0.98
    }
  }],
  warnings: []
};

describe("Quote Intelligence API", () => {
  let app: FastifyInstance;
  let service: CatalogApiService;
  let uploadIngestion: UploadIngestionApi;

  beforeEach(async () => {
    service = {
      list: vi.fn(async () => catalogPage),
      detail: vi.fn(async () => detailResponse),
      unmatched: vi.fn(async () => unmatchedResponse),
      reassign: vi.fn(async () => ({ status: "ok" as const, result: reassignResponse })),
      stats: vi.fn(async () => statsResponse),
      suppliers: vi.fn(async () => suppliersResponse),
      ingestionAudit: vi.fn(async () => ingestionAuditResponse),
      createSupplier: vi.fn(async () => ({ id: "55555555-5555-4555-8555-555555555555", name: "New Supplier" })),
      createCatalogItem: vi.fn(async () => catalogPage.items[0]!),
      deleteSupplier: vi.fn(async () => ({ success: true })),
      deleteCatalogItem: vi.fn(async () => ({ success: true }))
    };
    uploadIngestion = { ingest: vi.fn(async () => uploadResponse) };
    app = await buildServer({ catalog: service, uploadIngestion, logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /api/catalog validates pagination and returns catalog summaries", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/catalog?q=wait&page=1&pageSize=50"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(catalogPage);
    expect(service.list).toHaveBeenCalledWith({
      query: "wait",
      page: 1,
      pageSize: 50
    });
  });

  it("GET /api/catalog/:id returns complete item intelligence", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/catalog/${catalogItemId}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(detailResponse);
    expect(service.detail).toHaveBeenCalledWith(catalogItemId);
  });

  it("POST /api/line-items/:id/reassign persists a validated correction", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/line-items/${lineItemId}/reassign`,
      payload: { targetCatalogItemId: catalogItemId }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(reassignResponse);
    expect(service.reassign).toHaveBeenCalledWith(lineItemId, {
      targetCatalogItemId: catalogItemId
    });
  });

  it("GET /api/stats returns dataset overview metadata", async () => {
    const response = await app.inject({ method: "GET", url: "/api/stats" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(statsResponse);
    expect(service.stats).toHaveBeenCalledOnce();
  });

  it("GET /api/line-items/unmatched powers the review queue", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/line-items/unmatched"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(unmatchedResponse);
    expect(service.unmatched).toHaveBeenCalledOnce();
  });

  it("GET /api/suppliers validates and forwards optional date filters", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/suppliers?from=2026-01-01&to=2026-07-30"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(suppliersResponse);
    expect(service.suppliers).toHaveBeenCalledWith({
      from: "2026-01-01",
      to: "2026-07-30"
    });
  });

  it("GET /api/ingestion-runs returns ingestion provenance", async () => {
    const response = await app.inject({ method: "GET", url: "/api/ingestion-runs" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(ingestionAuditResponse);
    expect(service.ingestionAudit).toHaveBeenCalledOnce();
  });

  it("POST /api/ingest/upload accepts a PDF buffer and returns extraction results", async () => {
    const boundary = "quote-upload-boundary";
    const payload = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="quote.pdf"\r\n` +
      `Content-Type: application/pdf\r\n\r\n` +
      `%PDF-1.7 test\r\n` +
      `--${boundary}--\r\n`
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/ingest/upload",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(uploadResponse);
    expect(uploadIngestion.ingest).toHaveBeenCalledWith(expect.objectContaining({
      filename: "quote.pdf",
      fileType: "pdf"
    }));
  });

  it("POST /api/ingest/upload routes an XLSX buffer without a path helper", async () => {
    const boundary = "xlsx-upload-boundary";
    const preamble = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="SAMPLE_QUOTE_TO_TEST.xlsx"\r\n` +
      `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`
    );
    const payload = Buffer.concat([
      preamble,
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const response = await app.inject({
      method: "POST",
      url: "/api/ingest/upload",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload
    });

    expect(response.statusCode).toBe(201);
    expect(uploadIngestion.ingest).toHaveBeenCalledWith(expect.objectContaining({
      filename: "SAMPLE_QUOTE_TO_TEST.xlsx",
      fileType: "xlsx"
    }));
  });

  it("POST /api/ingest/upload rejects unsupported file types", async () => {
    const boundary = "quote-upload-boundary";
    const response = await app.inject({
      method: "POST",
      url: "/api/ingest/upload",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="quote.txt"\r\n\r\n` +
        `not a quote\r\n--${boundary}--\r\n`
      )
    });

    expect(response.statusCode).toBe(415);
    expect(uploadIngestion.ingest).not.toHaveBeenCalled();
  });

  it.each(["http://localhost:5173", "http://localhost:5174"])(
    "allows the local frontend origin %s",
    async (origin) => {
      const response = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { origin }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
    }
  );

  it("rejects malformed reassignment payloads before calling the service", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/line-items/${lineItemId}/reassign`,
      payload: {
        targetCatalogItemId: catalogItemId,
        newCatalogItemName: "Duplicate choice"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(service.reassign).not.toHaveBeenCalled();
  });
});
