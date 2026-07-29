import type { CatalogSummary } from "@quote-intelligence/domain";
import { describe, expect, it } from "vitest";
import { sortCatalogSummaries } from "./catalog-service";

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
    fairPrice: 100
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
    fairPrice: 1950
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
    fairPrice: null
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
