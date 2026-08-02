import type { CatalogSummary } from "@quote-intelligence/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { CatalogService, sortCatalogSummaries } from "./catalog-service";

const items: CatalogSummary[] = [
  {
    id: "a",
    name: "Waitstaff",
    description: null,
    category: "Staffing",
    primaryUnit: "person-hour",
    linkedLineItemCount: 4,
    supplierCount: 2,
    minPrice: 90,
    maxPrice: 110,
    fairPrice: 100,
    lastUploadedAt: "2026-07-30T09:00:00.000Z",
    variants: []
  },
  {
    id: "b",
    name: "Generator",
    description: null,
    category: "Power",
    primaryUnit: "item-day",
    linkedLineItemCount: 6,
    supplierCount: 3,
    minPrice: 1800,
    maxPrice: 2100,
    fairPrice: 1950,
    lastUploadedAt: "2026-07-31T09:00:00.000Z",
    variants: []
  },
  {
    id: "c",
    name: "Unpriced service",
    description: null,
    category: "Uncategorised",
    primaryUnit: "item",
    linkedLineItemCount: 1,
    supplierCount: 1,
    minPrice: null,
    maxPrice: null,
    fairPrice: null,
    lastUploadedAt: null,
    variants: []
  }
];

describe("catalog summary sorting", () => {
  it("sorts by fair price and always leaves missing prices last", () => {
    expect(
      sortCatalogSummaries(items, "fairPrice", "desc").map(({ id }) => id)
    ).toEqual(["b", "a", "c"]);
  });

  it("sorts by supplier count with name as a stable secondary column", () => {
    expect(
      sortCatalogSummaries(items, "supplierCount", "asc").map(({ id }) => id)
    ).toEqual(["c", "a", "b"]);
  });
});

interface FakeResult {
  data: unknown;
  count?: number | null;
  error: unknown;
}

interface FakeQuery extends PromiseLike<FakeResult> {
  select(...args: unknown[]): FakeQuery;
  eq(column: string, value: unknown): FakeQuery;
  order(...args: unknown[]): FakeQuery;
  limit(...args: unknown[]): FakeQuery;
  maybeSingle(...args: unknown[]): FakeQuery;
  gte(...args: unknown[]): FakeQuery;
  lte(...args: unknown[]): FakeQuery;
}

function databaseWithResults(
  results: Record<string, FakeResult[]>,
  filters: Array<[string, string, unknown]> = []
): SupabaseClient {
  const from = vi.fn((table: string) => {
    const result = results[table]?.shift();
    if (!result) throw new Error(`Missing fake result for ${table}.`);
    const promise = Promise.resolve(result);
    let query: FakeQuery;
    query = {
      select: () => query,
      eq: (column, value) => {
        filters.push([table, column, value]);
        return query;
      },
      order: () => query,
      limit: () => query,
      maybeSingle: () => query,
      gte: () => query,
      lte: () => query,
      then: promise.then.bind(promise)
    };
    return query;
  });
  return { from } as unknown as SupabaseClient;
}

describe("catalog database resilience", () => {
  it("returns safe zero metrics and null dates for a completely empty database", async () => {
    const filters: Array<[string, string, unknown]> = [];
    const database = databaseWithResults({
      quotes: [
        { data: null, count: 0, error: null },
        { data: null, error: null },
        { data: null, error: null }
      ],
      quote_line_items: [{ data: null, count: null, error: null }],
      catalog_items: [{ data: null, count: 0, error: null }],
      suppliers: [{ data: null, count: 0, error: null }]
    }, filters);

    await expect(new CatalogService(database).stats()).resolves.toEqual({
      totalQuotes: 0,
      totalLineItems: 0,
      catalogItemCount: 0,
      totalSuppliers: 0,
      dateRange: { from: null, to: null }
    });
    expect(filters).toEqual(expect.arrayContaining([
      ["catalog_items", "active", true],
      ["suppliers", "active", true]
    ]));
  });

  it("returns an empty supplier list when suppliers, quotes, and joins are absent", async () => {
    const database = databaseWithResults({
      suppliers: [{ data: null, error: null }],
      quotes: [{ data: null, error: null }],
      normalized_price_observations: [{ data: null, error: null }]
    });

    await expect(new CatalogService(database).suppliersPerformance({})).resolves.toEqual([]);
  });
});
