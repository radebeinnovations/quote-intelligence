import type { ExtractedDocument } from "./extraction";
import { nearlyEqual } from "./money";

export interface ValidationWarning {
  code:
    | "LINE_ARITHMETIC_MISMATCH"
    | "SUBTOTAL_MISMATCH"
    | "VAT_MISMATCH"
    | "TOTAL_MISMATCH";
  message: string;
  lineIndex?: number;
}

export function validateExtractedDocument(
  document: ExtractedDocument
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const lineSum = document.lineItems.reduce((sum, item, index) => {
    const calculated = item.quantity * item.unitRate;
    if (!nearlyEqual(calculated, item.lineTotal)) {
      warnings.push({
        code: "LINE_ARITHMETIC_MISMATCH",
        lineIndex: index,
        message: `${item.description}: quantity × rate is ${calculated.toFixed(2)}, source total is ${item.lineTotal.toFixed(2)}.`
      });
    }
    return sum + item.lineTotal;
  }, 0);

  const { quote } = document;
  if (quote.subtotal !== undefined && !nearlyEqual(lineSum, quote.subtotal)) {
    warnings.push({
      code: "SUBTOTAL_MISMATCH",
      message: `Line sum is ${lineSum.toFixed(2)}, source subtotal is ${quote.subtotal.toFixed(2)}.`
    });
  }

  if (
    quote.taxBasis === "exclusive" &&
    quote.subtotal !== undefined &&
    quote.vatAmount !== undefined
  ) {
    const expectedVat = quote.subtotal * quote.vatRate;
    if (!nearlyEqual(expectedVat, quote.vatAmount)) {
      warnings.push({
        code: "VAT_MISMATCH",
        message: `Expected VAT is ${expectedVat.toFixed(2)}, source VAT is ${quote.vatAmount.toFixed(2)}.`
      });
    }
  }

  return warnings;
}

