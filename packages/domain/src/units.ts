export type CanonicalPricingBasis =
  | "person-hour"
  | "item-day"
  | "person"
  | "platter"
  | "item"
  | "event"
  | "package"
  | "vehicle-km"
  | "vehicle-trip";

export interface UnitConversionResult {
  canonicalRate: number | null;
  canonicalBasis: CanonicalPricingBasis | null;
  estimated: boolean;
  explanation: string;
}

export interface CatalogRateNormalizationResult {
  canonicalRate: number | null;
  canonicalBasis: string | null;
  comparable: boolean;
  estimated: boolean;
  explanation: string;
}

export function normalizeStaffingRate(
  rateExVat: number,
  sourceUnit: string
): UnitConversionResult {
  const unit = (sourceUnit || "").trim().toLowerCase();
  if (unit === "hour") {
    return {
      canonicalRate: rateExVat,
      canonicalBasis: "person-hour",
      estimated: false,
      explanation: "Already priced per person-hour."
    };
  }
  if (unit === "4-hr callout") {
    return {
      canonicalRate: rateExVat / 4,
      canonicalBasis: "person-hour",
      estimated: false,
      explanation: "Four-hour callout divided by 4."
    };
  }
  if (unit === "12-hr shift") {
    return {
      canonicalRate: rateExVat / 12,
      canonicalBasis: "person-hour",
      estimated: false,
      explanation: "Twelve-hour shift divided by 12."
    };
  }
  if (unit === "day") {
    return {
      canonicalRate: rateExVat / 10,
      canonicalBasis: "person-hour",
      estimated: true,
      explanation: "Day rate divided by the supplier's stated maximum of 10 hours."
    };
  }
  return {
    canonicalRate: null,
    canonicalBasis: null,
    estimated: false,
    explanation: `No approved staffing conversion exists for "${sourceUnit}".`
  };
}

export function normalizeCatalogRate(
  rateExVat: number | null,
  sourceUnit: string,
  canonicalBasis: string
): CatalogRateNormalizationResult {
  if (rateExVat === null) {
    return {
      canonicalRate: null,
      canonicalBasis: null,
      comparable: false,
      estimated: false,
      explanation: "VAT basis is unknown."
    };
  }

  if (canonicalBasis === "person-hour") {
    const staffing = normalizeStaffingRate(rateExVat, sourceUnit);
    return {
      canonicalRate: staffing.canonicalRate,
      canonicalBasis: staffing.canonicalBasis,
      comparable: staffing.canonicalRate !== null,
      estimated: staffing.estimated,
      explanation: staffing.explanation
    };
  }

  const unit = (sourceUnit || "").trim().toLowerCase();
  const basis = (canonicalBasis || "").trim().toLowerCase();
  const compatibleUnits: Record<string, string[]> = {
    "item-day": ["each", "unit-day", "day"],
    item: ["each", "unit"],
    event: ["event"],
    package: ["package"],
    person: ["person"],
    platter: ["platter"],
    "vehicle-km": ["km"],
    "vehicle-trip": ["trip"]
  };
  const compatible = unit === basis || (compatibleUnits[basis] ?? []).includes(unit);
  return {
    canonicalRate: compatible ? rateExVat : null,
    canonicalBasis: compatible ? canonicalBasis : null,
    comparable: compatible,
    estimated: false,
    explanation: compatible
      ? `Source ${sourceUnit} rate is directly comparable as ${canonicalBasis}.`
      : `No approved conversion from ${sourceUnit} to ${canonicalBasis}.`
  };
}
