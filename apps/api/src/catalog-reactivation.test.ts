import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  reactivateCatalogItemIds,
  reactivateSourceCatalogItems
} from "./catalog-reactivation";

interface FakeResult {
  data: unknown;
  error: unknown;
}

interface FakeQuery extends PromiseLike<FakeResult> {
  select(...args: unknown[]): FakeQuery;
  update(value: unknown): FakeQuery;
  eq(column: string, value: unknown): FakeQuery;
  in(column: string, value: unknown[]): FakeQuery;
}

function databaseWithResults(
  results: Record<string, FakeResult[]>,
  calls: Array<{ table: string; operation: string; value: unknown }>
): SupabaseClient {
  const from = vi.fn((table: string) => {
    const result = results[table]?.shift();
    if (!result) throw new Error(`Missing fake result for ${table}.`);
    const promise = Promise.resolve(result);
    let query: FakeQuery;
    query = {
      select: () => query,
      update: (value) => {
        calls.push({ table, operation: "update", value });
        return query;
      },
      eq: (column, value) => {
        calls.push({ table, operation: `eq:${column}`, value });
        return query;
      },
      in: (column, value) => {
        calls.push({ table, operation: `in:${column}`, value });
        return query;
      },
      then: promise.then.bind(promise)
    };
    return query;
  });
  return { from } as unknown as SupabaseClient;
}

describe("catalog reactivation", () => {
  it("reactivates each matched catalog item once for an idempotent document", async () => {
    const calls: Array<{ table: string; operation: string; value: unknown }> = [];
    const database = databaseWithResults({
      quotes: [{ data: [{ id: "quote-1" }], error: null }],
      quote_line_items: [{
        data: [{ id: "line-1" }, { id: "line-2" }, { id: "line-3" }],
        error: null
      }],
      catalog_matches: [{
        data: [
          { catalog_item_id: "catalog-1" },
          { catalog_item_id: "catalog-1" },
          { catalog_item_id: null },
          { catalog_item_id: "catalog-2" }
        ],
        error: null
      }],
      catalog_items: [{ data: null, error: null }]
    }, calls);

    await expect(
      reactivateSourceCatalogItems(database, "user-1", "source-1")
    ).resolves.toBe(2);
    expect(calls).toContainEqual({
      table: "catalog_items",
      operation: "update",
      value: { active: true }
    });
    expect(calls).toContainEqual({
      table: "catalog_items",
      operation: "in:id",
      value: ["catalog-1", "catalog-2"]
    });
  });

  it("does not issue a database update when no catalog ids are present", async () => {
    const from = vi.fn();
    const database = { from } as unknown as SupabaseClient;

    await expect(
      reactivateCatalogItemIds(database, "user-1", [])
    ).resolves.toBe(0);
    expect(from).not.toHaveBeenCalled();
  });
});
