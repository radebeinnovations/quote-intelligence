import type { TaxBasis } from "./extraction";

export interface TaxNormalization {
  amountExVat: number | null;
  wasConverted: boolean;
  reason: string;
}

export function normalizeToExVat(
  amount: number,
  taxBasis: TaxBasis,
  vatRate = 0.15
): TaxNormalization {
  if (taxBasis === "unknown") {
    return {
      amountExVat: null,
      wasConverted: false,
      reason: "Tax basis is unknown; excluded from comparable analytics."
    };
  }

  if (taxBasis === "exclusive") {
    return {
      amountExVat: amount,
      wasConverted: false,
      reason: "Source amount is VAT-exclusive."
    };
  }

  return {
    amountExVat: amount / (1 + vatRate),
    wasConverted: true,
    reason: `Converted from VAT-inclusive pricing at ${vatRate * 100}%.`
  };
}

export function nearlyEqual(
  actual: number,
  expected: number,
  absoluteTolerance = 0.02
): boolean {
  return Math.abs(actual - expected) <= absoluteTolerance;
}

