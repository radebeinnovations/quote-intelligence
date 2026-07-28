import { z } from "zod";

export interface StatsResponse {
  totalQuotes: number;
  totalLineItems: number;
  catalogItemCount: number;
  totalSuppliers: number;
  dateRange: { from: string | null; to: string | null };
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
