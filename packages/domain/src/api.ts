import { z } from "zod";

export const CATALOG_CATEGORIES = [
  "Staffing",
  "Power",
  "Equipment hire",
  "Catering",
  "Transport",
  "Production",
  "Decor",
  "Uncategorised"
] as const;

export const catalogCategorySchema = z.preprocess((value) => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  return (
    CATALOG_CATEGORIES.find((category) => category.toLowerCase() === normalized) ??
    value.trim()
  );
}, z.enum(CATALOG_CATEGORIES));

export const catalogSortBySchema = z.enum([
  "name",
  "fairPrice",
  "supplierCount"
]);

export const sortOrderSchema = z.enum(["asc", "desc"]);

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date in YYYY-MM-DD format.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Use a valid calendar date.");

export const isoDateTimeSchema = z.string().trim().transform((value, context) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Use a valid date-time."
    });
    return z.NEVER;
  }
  return parsed.toISOString();
});

const dateRangeShape = {
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional()
};

function validateDateRange(
  input: { from?: string | undefined; to?: string | undefined },
  context: z.RefinementCtx
): void {
  if (input.from && input.to && input.from > input.to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The from date must be on or before the to date.",
      path: ["to"]
    });
  }
}

export const dateRangeQuerySchema = z
  .object(dateRangeShape)
  .superRefine(validateDateRange);

export const catalogListQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    category: catalogCategorySchema.optional(),
    sortBy: catalogSortBySchema.default("name"),
    sortOrder: sortOrderSchema.default("asc"),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    ...dateRangeShape
  })
  .superRefine(validateDateRange);

export const supplierListQuerySchema = dateRangeQuerySchema;

export type CatalogCategory = z.infer<typeof catalogCategorySchema>;
export type CatalogSortBy = z.infer<typeof catalogSortBySchema>;
export type SortOrder = z.infer<typeof sortOrderSchema>;
export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;
export type CatalogListQuery = z.infer<typeof catalogListQuerySchema>;
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;

export interface StatsResponse {
  totalQuotes: number;
  totalLineItems: number;
  catalogItemCount: number;
  totalSuppliers: number;
  dateRange: { from: string | null; to: string | null };
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
  lastUploadedAt: string | null;
  variants: CatalogVariant[];
}

export interface CatalogVariant {
  id: string;
  label: string;
  attributes: Record<string, string>;
  primaryUnit: string;
  pricingBasis: string;
  observationCount: number;
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
  variantId: string | null;
  variantLabel: string;
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

export interface SupplierPerformance {
  supplierId: string;
  supplierName: string;
  email: string | null;
  phone: string | null;
  quoteCount: number;
  lineItemCount: number;
  firstQuoteDate: string | null;
  lastQuoteDate: string | null;
  averageRate: number;
  variancePercent: number | null;
  totalSpend: number;
  competitivenessIndex: number | null;
}

export interface SupplierQuoteLineRecord {
  id: string;
  sourceRow: string | null;
  rawDescription: string;
  quantity: number;
  rawUnit: string;
  rawRate: number;
  rawTotal: number;
  normalizedRate: number | null;
  normalizedBasis: string | null;
  catalogItemName: string | null;
  variantLabel: string | null;
}

export interface SupplierQuoteRecord {
  id: string;
  quoteNumber: string;
  quoteDate: string;
  eventName: string | null;
  totalExVat: number | null;
  originalFilename: string;
  sourceDocumentId: string;
  downloadUrl: string | null;
  lines: SupplierQuoteLineRecord[];
}

export interface SupplierProfileResponse {
  supplier: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    vatNumber: string | null;
  };
  quoteCount: number;
  totalSpend: number;
  competitivenessIndex: number | null;
  quotes: SupplierQuoteRecord[];
}

export interface IngestionDocumentAudit {
  id: string;
  filename: string;
  fileType: string;
  sha256: string;
  status: string;
  warnings: string[];
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
  iqrLow: number | null;
  iqrHigh: number | null;
  filteredMean: number | null;
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
    variants: CatalogVariant[];
  };
  priceHistory: PriceHistoryPoint[];
  supplierComparison: SupplierComparison[];
  fairPrice: FairPriceDetail;
  linkedLineItems: LinkedLineItem[];
}

export const catalogDetailQuerySchema = z.object({
  variantIds: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim()
        ? value.split(",").map((item) => item.trim()).filter(Boolean)
        : value,
    z.array(z.string().uuid()).max(20).default([])
  )
});

export type CatalogDetailQuery = z.infer<typeof catalogDetailQuerySchema>;

export const batchQuoteUploadSchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().trim().min(1).max(240),
        mimeType: z.enum([
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ]),
        contentBase64: z
          .string()
          .min(4)
          .max(35_000_000, "Encoded files must be 25 MB or smaller.")
          .regex(/^[A-Za-z0-9+/]*={0,2}$/, "File content must be valid base64.")
      })
    )
    .min(1)
    .max(20)
});

export type BatchQuoteUploadInput = z.infer<typeof batchQuoteUploadSchema>;

export interface BatchQuoteUploadResult {
  runId: string;
  accepted: number;
  documents: Array<{
    filename: string;
    status: "parsed" | "failed";
    warningCount: number;
    error: string | null;
  }>;
}

export interface CatalogNormalizationRetryResult {
  documentsRetried: number;
  linesRetried: number;
  documentsFailed: number;
}

export const catalogNormalizationLineSchema = z.object({
  lineItemId: z.string().min(1),
  action: z.enum(["match", "create"]),
  catalogItemId: z.string().uuid().nullable(),
  baseName: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(80),
  variantLabel: z.string().trim().min(1).max(120),
  variantAttributes: z.record(z.string().trim().max(160)),
  canonicalUnit: z.string().trim().min(1).max(80),
  pricingBasis: z.string().trim().min(1).max(80),
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(1).max(500)
});

export const catalogNormalizationResponseSchema = z.object({
  lines: z.array(catalogNormalizationLineSchema)
});

export type CatalogNormalizationLine = z.infer<
  typeof catalogNormalizationLineSchema
>;
export type CatalogNormalizationResponse = z.infer<
  typeof catalogNormalizationResponseSchema
>;

export const reassignLineItemSchema = z
  .object({
    targetCatalogItemId: z.string().uuid().optional(),
    targetVariantId: z.string().uuid().nullable().optional(),
    newCatalogItemName: z.string().trim().min(2).max(120).optional()
  })
  .refine(
    ({ targetCatalogItemId, newCatalogItemName }) =>
      Boolean(targetCatalogItemId) !== Boolean(newCatalogItemName),
    "Provide exactly one of targetCatalogItemId or newCatalogItemName."
  );

export type ReassignLineItemInput = z.infer<typeof reassignLineItemSchema>;

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

export interface ReassignLineItemResult {
  lineItemId: string;
  catalogItemId: string;
  created: boolean;
  comparable: boolean;
  canonicalRate: number | null;
  canonicalBasis: string | null;
}

const nullableFiniteNumber = z.number().finite().nullable();
const nullableString = z.string().nullable();

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("quote-intelligence-api")
});

export const uploadQuoteResponseSchema: z.ZodType<UploadQuoteResponse> = z.object({
  idempotent: z.boolean(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  filename: z.string(),
  supplier: z.object({ id: z.string().uuid(), name: z.string() }),
  quote: z.object({
    id: z.string().uuid(),
    quoteNumber: z.string(),
    quoteDate: isoDateSchema,
    currency: z.string(),
    total: nullableFiniteNumber
  }),
  lineItems: z.array(
    z.object({
      id: z.string().uuid(),
      sourceRow: nullableString,
      description: z.string(),
      quantity: z.number().finite(),
      unit: z.string(),
      unitRate: z.number().finite(),
      lineTotal: z.number().finite(),
      match: z.object({
        catalogItemId: z.string().uuid().nullable(),
        catalogItemName: nullableString,
        status: z.enum(["matched", "review", "unmatched"]),
        confidence: z.number().min(0).max(1).nullable()
      })
    })
  ),
  warnings: z.array(z.string())
});

export const createdSupplierResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string()
});

export const mutationSuccessResponseSchema = z.object({
  success: z.literal(true)
});

export const authMeResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable()
});

export const catalogVariantResponseSchema: z.ZodType<CatalogVariant> = z.object({
  id: z.string().uuid(),
  label: z.string(),
  attributes: z.record(z.string()),
  primaryUnit: z.string(),
  pricingBasis: z.string(),
  observationCount: z.number().int().nonnegative()
});

export const catalogSummaryResponseSchema: z.ZodType<CatalogSummary> = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: nullableString,
  category: z.string(),
  primaryUnit: z.string(),
  linkedLineItemCount: z.number().int().nonnegative(),
  supplierCount: z.number().int().nonnegative(),
  minPrice: nullableFiniteNumber,
  maxPrice: nullableFiniteNumber,
  fairPrice: nullableFiniteNumber,
  lastUploadedAt: isoDateTimeSchema.nullable(),
  variants: z.array(catalogVariantResponseSchema)
});

export const paginatedCatalogResponseSchema: z.ZodType<PaginatedCatalogResponse> =
  z.object({
    items: z.array(catalogSummaryResponseSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative()
  });

const priceHistoryPointResponseSchema: z.ZodType<PriceHistoryPoint> = z.object({
  date: isoDateSchema,
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  rate: z.number().finite(),
  rawRate: z.number().finite(),
  unit: z.string(),
  total: z.number().finite(),
  quoteNumber: z.string(),
  quoteId: z.string().uuid(),
  estimated: z.boolean(),
  variantId: z.string().uuid().nullable(),
  variantLabel: z.string()
});

const supplierComparisonResponseSchema: z.ZodType<SupplierComparison> = z.object({
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  averageRate: z.number().finite(),
  minRate: z.number().finite(),
  maxRate: z.number().finite(),
  lastQuotedRate: z.number().finite(),
  lastQuoteDate: isoDateSchema,
  quoteCount: z.number().int().nonnegative(),
  primaryUnit: z.string()
});

const fairPriceDetailResponseSchema: z.ZodType<FairPriceDetail> = z.object({
  value: nullableFiniteNumber,
  overallMedian: nullableFiniteNumber,
  recentMedian: nullableFiniteNumber,
  mean: nullableFiniteNumber,
  sampleSize: z.number().int().nonnegative(),
  supplierCount: z.number().int().nonnegative(),
  method: z.enum(["no-data", "median", "weighted-median"]),
  confidence: z.number().min(0).max(1),
  excludedCount: z.number().int().nonnegative(),
  outlierCount: z.number().int().nonnegative(),
  iqrLow: nullableFiniteNumber,
  iqrHigh: nullableFiniteNumber,
  filteredMean: nullableFiniteNumber,
  formula: z.string(),
  observations: z.array(
    z.object({
      date: isoDateSchema,
      supplierName: z.string(),
      rate: z.number().finite(),
      outlier: z.boolean()
    })
  )
});

const linkedLineItemResponseSchema: z.ZodType<LinkedLineItem> = z.object({
  id: z.string().uuid(),
  description: z.string(),
  supplierName: z.string(),
  quoteNumber: z.string(),
  quoteId: z.string().uuid(),
  date: isoDateSchema,
  quantity: z.number().finite(),
  rawUnit: z.string(),
  rawRate: z.number().finite(),
  normalizedRate: nullableFiniteNumber,
  normalizedUnit: nullableString,
  estimated: z.boolean(),
  comparable: z.boolean(),
  arithmeticValid: z.boolean(),
  taxBasis: z.enum(["inclusive", "exclusive", "unknown"])
});

export const catalogDetailResponseSchema: z.ZodType<CatalogDetailResponse> =
  z.object({
    item: z.object({
      id: z.string().uuid(),
      name: z.string(),
      description: nullableString,
      category: z.string(),
      primaryUnit: z.string(),
      pricingBasis: z.string(),
      attributes: z.record(z.unknown()),
      variants: z.array(catalogVariantResponseSchema)
    }),
    priceHistory: z.array(priceHistoryPointResponseSchema),
    supplierComparison: z.array(supplierComparisonResponseSchema),
    fairPrice: fairPriceDetailResponseSchema,
    linkedLineItems: z.array(linkedLineItemResponseSchema)
  });

export const unmatchedLineItemsResponseSchema: z.ZodType<UnmatchedLineItemsResponse> =
  z.object({
    items: z.array(
      z.object({
        id: z.string().uuid(),
        description: z.string(),
        supplierName: z.string(),
        quoteNumber: z.string(),
        quoteId: z.string().uuid(),
        date: isoDateSchema,
        quantity: z.number().finite(),
        rawUnit: z.string(),
        rawRate: z.number().finite(),
        taxBasis: z.enum(["inclusive", "exclusive", "unknown"])
      })
    ),
    total: z.number().int().nonnegative()
  });

export const reassignLineItemResultSchema: z.ZodType<ReassignLineItemResult> =
  z.object({
    lineItemId: z.string().uuid(),
    catalogItemId: z.string().uuid(),
    created: z.boolean(),
    comparable: z.boolean(),
    canonicalRate: nullableFiniteNumber,
    canonicalBasis: nullableString
  });

export const statsResponseSchema: z.ZodType<StatsResponse> = z.object({
  totalQuotes: z.number().int().nonnegative(),
  totalLineItems: z.number().int().nonnegative(),
  catalogItemCount: z.number().int().nonnegative(),
  totalSuppliers: z.number().int().nonnegative(),
  dateRange: z.object({
    from: isoDateSchema.nullable(),
    to: isoDateSchema.nullable()
  })
});

export const supplierPerformanceResponseSchema: z.ZodType<SupplierPerformance[]> =
  z.array(
    z.object({
      supplierId: z.string().uuid(),
      supplierName: z.string(),
      email: nullableString,
      phone: nullableString,
      quoteCount: z.number().int().nonnegative(),
      lineItemCount: z.number().int().nonnegative(),
      firstQuoteDate: isoDateSchema.nullable(),
      lastQuoteDate: isoDateSchema.nullable(),
      averageRate: z.number().finite(),
      variancePercent: nullableFiniteNumber,
      totalSpend: z.number().finite(),
      competitivenessIndex: nullableFiniteNumber
    })
  );

const supplierQuoteLineResponseSchema: z.ZodType<SupplierQuoteLineRecord> = z.object({
  id: z.string().uuid(),
  sourceRow: nullableString,
  rawDescription: z.string(),
  quantity: z.number().finite(),
  rawUnit: z.string(),
  rawRate: z.number().finite(),
  rawTotal: z.number().finite(),
  normalizedRate: nullableFiniteNumber,
  normalizedBasis: nullableString,
  catalogItemName: nullableString,
  variantLabel: nullableString
});

export const supplierProfileResponseSchema: z.ZodType<SupplierProfileResponse> =
  z.object({
    supplier: z.object({
      id: z.string().uuid(),
      name: z.string(),
      email: nullableString,
      phone: nullableString,
      address: nullableString,
      vatNumber: nullableString
    }),
    quoteCount: z.number().int().nonnegative(),
    totalSpend: z.number().finite(),
    competitivenessIndex: nullableFiniteNumber,
    quotes: z.array(
      z.object({
        id: z.string().uuid(),
        quoteNumber: z.string(),
        quoteDate: isoDateSchema,
        eventName: nullableString,
        totalExVat: nullableFiniteNumber,
        originalFilename: z.string(),
        sourceDocumentId: z.string().uuid(),
        downloadUrl: z.string().url().nullable(),
        lines: z.array(supplierQuoteLineResponseSchema)
      })
    )
  });

export const ingestionAuditResponseSchema: z.ZodType<IngestionRunAudit[]> = z.array(
  z.object({
    id: z.string().uuid(),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    status: z.string(),
    parserVersion: z.string(),
    matchingVersion: z.string(),
    documentCount: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    documents: z.array(
      z.object({
        id: z.string().uuid(),
        filename: z.string(),
        fileType: z.string(),
        sha256: z.string(),
        status: z.string(),
        warnings: z.array(z.string()),
        createdAt: z.string().datetime()
      })
    )
  })
);

export const batchQuoteUploadResultSchema: z.ZodType<BatchQuoteUploadResult> = z.object({
  runId: z.string().uuid(),
  accepted: z.number().int().nonnegative(),
  documents: z.array(
    z.object({
      filename: z.string(),
      status: z.enum(["parsed", "failed"]),
      warningCount: z.number().int().nonnegative(),
      error: nullableString
    })
  )
});

export const catalogNormalizationRetryResultSchema: z.ZodType<CatalogNormalizationRetryResult> =
  z.object({
    documentsRetried: z.number().int().nonnegative(),
    linesRetried: z.number().int().nonnegative(),
    documentsFailed: z.number().int().nonnegative()
  });
