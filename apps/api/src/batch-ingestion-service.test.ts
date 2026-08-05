import type { CatalogNormalizationLine } from "@quote-intelligence/domain";
import { describe, expect, it } from "vitest";
import {
  isOpenAICreditExhaustion,
  protectedAttributeConflict
} from "./batch-ingestion-service";

function normalized(overrides: Partial<CatalogNormalizationLine> = {}): CatalogNormalizationLine {
  return {
    lineItemId: "line-1",
    action: "create",
    catalogItemId: null,
    baseName: "White Gazebo",
    category: "Equipment hire",
    variantLabel: "3 m × 3 m",
    variantAttributes: { size: "3 m × 3 m", specification: "white" },
    canonicalUnit: "item-day",
    pricingBasis: "item-day",
    confidence: 0.95,
    rationale: "Explicit protected attributes retained.",
    ...overrides
  };
}

describe("AI normalization safety guard", () => {
  it("accepts protected dimensions when the variant retains them", () => {
    expect(
      protectedAttributeConflict("White Gazebo 3m x 3m per day", normalized())
    ).toBeNull();
  });

  it("recognizes exhausted OpenAI credits without treating rate limits as quota exhaustion", () => {
    expect(
      isOpenAICreditExhaustion(
        new Error("OpenAI failed: credit_balance_exhausted (insufficient_quota)")
      )
    ).toBe(true);
    expect(isOpenAICreditExhaustion(new Error("rate_limit_exceeded"))).toBe(false);
  });

  it("rejects a gazebo size merge that drops the source dimension", () => {
    expect(
      protectedAttributeConflict(
        "White Gazebo 5m x 5m per day",
        normalized()
      )
    ).toContain("5 × 5");
  });

  it("keeps per-kilometre and per-trip transport bases separate", () => {
    expect(
      protectedAttributeConflict(
        "8t Truck Hire – Metro Trip",
        normalized({
          baseName: "Truck logistics",
          variantLabel: "8 ton",
          variantAttributes: { weightClass: "8 ton" },
          canonicalUnit: "vehicle-km",
          pricingBasis: "vehicle-km"
        })
      )
    ).toContain("non-trip");
  });
});
