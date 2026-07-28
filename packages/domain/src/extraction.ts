import { z } from "zod";

export const taxBasisSchema = z.enum(["inclusive", "exclusive", "unknown"]);

const optionalText = z.string().trim().min(1).optional();
const optionalMoney = z.number().finite().nonnegative().optional();

export const extractedSupplierSchema = z.object({
  name: z.string().trim().min(1),
  vatNumber: optionalText,
  contactName: optionalText,
  email: z.string().email().optional(),
  phone: optionalText,
  address: optionalText
});

export const extractedQuoteSchema = z.object({
  quoteNumber: z.string().trim().min(1),
  revisionNumber: z.number().int().nonnegative().optional(),
  dateText: z.string().trim().min(1),
  eventName: optionalText,
  currency: z.string().length(3).default("ZAR"),
  vatRate: z.number().min(0).max(1).default(0.15),
  taxBasis: taxBasisSchema.default("unknown"),
  subtotal: optionalMoney,
  vatAmount: optionalMoney,
  total: optionalMoney
});

export const extractedLineItemSchema = z.object({
  sourceRow: z.string().optional(),
  description: z.string().trim().min(1),
  quantity: z.number().finite().positive(),
  unit: z.string().trim().min(1),
  unitRate: z.number().finite().nonnegative(),
  lineTotal: z.number().finite().nonnegative()
});

export const extractedDocumentSchema = z.object({
  supplier: extractedSupplierSchema,
  quote: extractedQuoteSchema,
  lineItems: z.array(extractedLineItemSchema).min(1),
  notes: z.array(z.string()).default([]),
  extractionWarnings: z.array(z.string()).default([])
});

export type TaxBasis = z.infer<typeof taxBasisSchema>;
export type ExtractedDocument = z.infer<typeof extractedDocumentSchema>;
export type ExtractedLineItem = z.infer<typeof extractedLineItemSchema>;

