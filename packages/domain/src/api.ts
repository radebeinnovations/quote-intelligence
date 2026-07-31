import { z } from "zod";

export interface StatsResponse {
  totalQuotes: number;
  totalLineItems: number;
  catalogItemCount: number;
  totalSuppliers: number;
  dateRange: { from: string | null; to: string | null };
}

export interface DateRangeQuery {
  from?: string;
  to?: string;
}

export interface SupplierAnalytics {
  supplierId: string;
  supplierName: string;
  email: string | null;
  phone: string | null;
  quoteCount: number;
  lineItemCount: number;
  averageRate: number | null;
  variancePercent: number | null;
  firstQuoteDate: string | null;
  lastQuoteDate: string | null;
}

export interface IngestionDocumentAudit {
  id: string;
  filename: string;
  fileType: string;
  sha256: string;
  status: string;
  warnings: unknown;
  createdAt: string;
}

export interface IngestionRunAudit {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  parserVersion: string;
  matchingVersion: string;
  documentCount: number;
  errorCount: number;
  documents: IngestionDocumentAudit[];
}

export interface UploadedCatalogMatch {
  catalogItemId: string | null;
  catalogItemName: string | null;
  status: "matched" | "review" | "unmatched";
  confidence: number | null;
}

export interface UploadedQuoteLineItem {
  id: string;
  sourceRow: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitRate: number;
  lineTotal: number;
  match: UploadedCatalogMatch;
}

export interface UploadQuoteResponse {
  idempotent: boolean;
  sha256: string;
  filename: string;
  supplier: { id: string; name: string };
  quote: {
    id: string;
    quoteNumber: string;
    quoteDate: string;
    currency: string;
    total: number | null;
  };
  lineItems: UploadedQuoteLineItem[];
  warnings: string[];
}

export interface CatalogSummary {
  id: string;
  name: string;
  description: string | null;
  category: string;
  primaryUnit: string;
  linkedLineItemCount: number;
  supplierCount: number;
  minPrice: number | null;
  maxPrice: number | null;
  fairPrice: number | null;
}

export interface PaginatedCatalogResponse {
  items: CatalogSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PriceHistoryPoint {
  date: string;
  supplierId: string;
  supplierName: string;
  rate: number;
  rawRate: number;
  unit: string;
  total: number;
  quoteNumber: string;
  quoteId: string;
  estimated: boolean;
}

export interface SupplierComparison {
  supplierId: string;
  supplierName: string;
  averageRate: number;
  minRate: number;
  maxRate: number;
  lastQuotedRate: number;
  lastQuoteDate: string;
  quoteCount: number;
  primaryUnit: string;
}

export interface FairPriceDetail {
  value: number | null;
  overallMedian: number | null;
  recentMedian: number | null;
  mean: number | null;
  sampleSize: number;
  supplierCount: number;
  method: "no-data" | "median" | "weighted-median";
  confidence: number;
  excludedCount: number;
  outlierCount: number;
  formula: string;
  observations: Array<{
    date: string;
    supplierName: string;
    rate: number;
    outlier: boolean;
  }>;
}

export interface LinkedLineItem {
  id: string;
  description: string;
  supplierName: string;
  quoteNumber: string;
  quoteId: string;
  date: string;
  quantity: number;
  rawUnit: string;
  rawRate: number;
  normalizedRate: number | null;
  normalizedUnit: string | null;
  estimated: boolean;
  comparable: boolean;
  arithmeticValid: boolean;
  taxBasis: "inclusive" | "exclusive" | "unknown";
}

export interface UnmatchedLineItem {
  id: string;
  description: string;
  supplierName: string;
  quoteNumber: string;
  quoteId: string;
  date: string;
  quantity: number;
  rawUnit: string;
  rawRate: number;
  taxBasis: "inclusive" | "exclusive" | "unknown";
}

export interface UnmatchedLineItemsResponse {
  items: UnmatchedLineItem[];
  total: number;
}

export interface CatalogDetailResponse {
  item: {
    id: string;
    name: string;
    description: string | null;
    category: string;
    primaryUnit: string;
    pricingBasis: string;
    attributes: Record<string, unknown>;
  };
  priceHistory: PriceHistoryPoint[];
  supplierComparison: SupplierComparison[];
  fairPrice: FairPriceDetail;
  linkedLineItems: LinkedLineItem[];
}

export const reassignLineItemSchema = z
  .object({
    targetCatalogItemId: z.string().uuid().optional(),
    newCatalogItemName: z.string().trim().min(2).max(120).optional()
  })
  .refine(
    ({ targetCatalogItemId, newCatalogItemName }) =>
      Boolean(targetCatalogItemId) !== Boolean(newCatalogItemName),
    "Provide exactly one of targetCatalogItemId or newCatalogItemName."
  );

export type ReassignLineItemInput = z.infer<typeof reassignLineItemSchema>;

export interface ReassignLineItemResult {
  lineItemId: string;
  catalogItemId: string;
  created: boolean;
  comparable: boolean;
  canonicalRate: number | null;
  canonicalBasis: string | null;
}

export const createSupplierSchema = z.object({
  name: z.string().trim().min(2, "Supplier name must be at least 2 characters.").max(120),
  email: z.string().trim().email("Invalid email address.").optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional().or(z.literal(""))
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const createCatalogItemSchema = z.object({
  name: z.string().trim().min(2, "Service name must be at least 2 characters.").max(120),
  category: z.string().trim().min(2).max(60).default("General"),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  pricingBasis: z.string().trim().min(1, "Pricing basis is required.").max(50).default("item")
});

export type CreateCatalogItemInput = z.infer<typeof createCatalogItemSchema>;
