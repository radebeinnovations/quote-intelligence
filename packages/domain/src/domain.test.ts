import { describe, expect, it } from "vitest";
import { isoDateTimeSchema } from "./api";
import { calculateFairPrice } from "./fair-price";
import { normalizeToExVat } from "./money";
import { normalizeCatalogRate, normalizeStaffingRate } from "./units";

describe("API date-time normalization", () => {
  it("converts Supabase SQL timestamps to strict ISO date-times", () => {
    expect(isoDateTimeSchema.parse("2026-08-05 07:04:33.879+00")).toBe(
      "2026-08-05T07:04:33.879Z"
    );
  });
});

describe("tax normalization", () => {
  it("converts VAT-inclusive prices to ex-VAT", () => {
    expect(normalizeToExVat(115, "inclusive").amountExVat).toBeCloseTo(100);
  });
});

describe("staffing normalization", () => {
  it("converts a four-hour callout to a person-hour rate", () => {
    expect(normalizeStaffingRate(240, "4-hr callout").canonicalRate).toBe(60);
  });

  it("marks a day-rate conversion as estimated", () => {
    expect(normalizeStaffingRate(600, "day").estimated).toBe(true);
  });

  it("recalculates a callout when assigned to a person-hour catalog item", () => {
    expect(normalizeCatalogRate(240, "4-hr callout", "person-hour")).toMatchObject({
      canonicalRate: 60,
      canonicalBasis: "person-hour",
      comparable: true
    });
  });

  it("marks incompatible reassignment bases as non-comparable", () => {
    expect(normalizeCatalogRate(240, "trip", "vehicle-km")).toMatchObject({
      canonicalRate: null,
      canonicalBasis: null,
      comparable: false
    });
  });
});

describe("fair price", () => {
  it("weights the overall and recent medians with at least three recent samples", () => {
    const result = calculateFairPrice(
      [
        { rate: 80, observedAt: new Date("2025-01-01"), supplierId: "a" },
        { rate: 100, observedAt: new Date("2026-04-01"), supplierId: "a" },
        { rate: 110, observedAt: new Date("2026-05-01"), supplierId: "b" },
        { rate: 120, observedAt: new Date("2026-06-01"), supplierId: "c" }
      ],
      new Date("2026-07-01")
    );
    expect(result.method).toBe("weighted-median");
    expect(result.fairPrice).toBe(106.5);
  });
});
