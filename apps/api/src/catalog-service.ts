import {
  calculateFairPrice,
  normalizeCatalogRate,
  type CatalogDetailResponse,
  type CatalogDetailQuery,
  type CatalogListQuery,
  type CatalogSummary,
  type CatalogSortBy,
  type CatalogVariant,
  type CreateCatalogItemInput,
  type CreateSupplierInput,
  type DateRangeQuery,
  type FairPriceDetail,
  type LinkedLineItem,
  type PaginatedCatalogResponse,
  type PriceHistoryPoint,
  type ReassignLineItemInput,
  type ReassignLineItemResult,
  type SortOrder,
  type StatsResponse,
  type UnmatchedLineItemsResponse,
  type SupplierComparison,
  type SupplierProfileResponse,
  type SupplierListQuery,
  type SupplierPerformance,
  type IngestionRunAudit
} from "@quote-intelligence/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

interface CatalogRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  canonical_unit: string;
  canonical_pricing_basis: string;
  attributes: Record<string, unknown> | null;
}

interface CatalogVariantRow {
  id: string;
  catalog_item_id: string;
  label: string;
  attributes: Record<string, unknown> | null;
  canonical_unit: string;
  canonical_pricing_basis: string;
}

interface LineItemForReassignment {
  id: string;
  unit_raw: string;
  unit_rate_ex_vat: number | string | null;
}

interface CatalogBasisRow {
  id: string;
  canonical_pricing_basis: string;
}

interface VariantBasisRow {
  id: string;
  canonical_pricing_basis: string;
}

interface RecordWithId {
  id: string;
}

interface IngestionRunRow {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  parser_version: string;
  matching_version: string;
  document_count: number | null;
  error_count: number | null;
}

interface SourceDocumentAuditRow {
  id: string;
  ingestion_run_id: string;
  filename: string;
  file_type: string;
  sha256: string;
  extraction_status: string;
  extraction_warnings: unknown;
  created_at: string;
}

export type ReassignOutcome =
  | { status: "ok"; result: ReassignLineItemResult }
  | { status: "line-item-not-found" }
  | { status: "target-not-found" };

interface ObservationRow {
  line_item_id: string;
  quote_id: string;
  quote_number: string;
  quote_date: string;
  is_current_revision: boolean;
  supplier_id: string;
  supplier_name: string;
  catalog_item_id: string | null;
  match_status: "matched" | "review" | "unmatched" | null;
  variant_id: string | null;
  variant_label: string | null;
  variant_attributes: Record<string, unknown> | null;
  source_row: string | null;
  description_raw: string;
  quantity_raw: number | string;
  unit_raw: string;
  unit_rate_raw: number | string;
  line_total_raw: number | string;
  line_total_ex_vat: number | string | null;
  source_created_at: string;
  tax_basis: "inclusive" | "exclusive" | "unknown";
  unit_rate_ex_vat: number | string | null;
  canonical_rate_ex_vat: number | string | null;
  canonical_basis: string | null;
  estimated: boolean | null;
  comparable: boolean | null;
  explanation: string | null;
  arithmetic_valid: boolean;
  validation_status: "valid" | "warning" | "invalid";
}

const numberOrNull = (value: number | string | null): number | null => {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function requireData<T>(data: T | null, operation: string): T {
  if (data === null) throw new Error(`${operation} returned no database row.`);
  return data;
}

function canonicalSupplierName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b\(pty\)|\bltd\b|\bcc\b|[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0
  );
}

function validAnalyticsObservation(row: ObservationRow): boolean {
  return (
    row.is_current_revision &&
    row.arithmetic_valid &&
    row.match_status === "matched" &&
    row.comparable === true &&
    numberOrNull(row.canonical_rate_ex_vat) !== null
  );
}

export function filterObservationsByDateRange<T extends { quote_date: string }>(
  rows: T[],
  range: DateRangeQuery
): T[] {
  return rows.filter(
    ({ quote_date }) =>
      (!range.from || quote_date >= range.from) &&
      (!range.to || quote_date <= range.to)
  );
}

function latestDate(rows: ObservationRow[]): Date {
  const timestamps = rows.map(({ quote_date }) => Date.parse(quote_date));
  return new Date(Math.max(...timestamps, Date.now()));
}

function quartiles(values: number[]): { low: number; high: number } | null {
  if (values.length < 4) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const medianOf = (items: number[]): number => {
    const middle = Math.floor(items.length / 2);
    return items.length % 2
      ? items[middle]!
      : (items[middle - 1]! + items[middle]!) / 2;
  };
  const middle = Math.floor(sorted.length / 2);
  const lower = sorted.slice(0, middle);
  const upper = sorted.slice(sorted.length % 2 ? middle + 1 : middle);
  const q1 = medianOf(lower);
  const q3 = medianOf(upper);
  const iqr = q3 - q1;
  return { low: q1 - 1.5 * iqr, high: q3 + 1.5 * iqr };
}

function buildFairPrice(rows: ObservationRow[]): FairPriceDetail {
  const included = rows.filter(validAnalyticsObservation);
  const rates = included.map((row) => numberOrNull(row.canonical_rate_ex_vat)!);
  const bounds = quartiles(rates);
  const observations = included.map((row) => {
    const rate = numberOrNull(row.canonical_rate_ex_vat)!;
    return {
      date: row.quote_date,
      supplierName: row.supplier_name,
      rate,
      outlier: bounds ? rate < bounds.low || rate > bounds.high : false
    };
  });
  const result = calculateFairPrice(
    included.map((row) => ({
      rate: numberOrNull(row.canonical_rate_ex_vat)!,
      observedAt: new Date(`${row.quote_date}T00:00:00Z`),
      supplierId: row.supplier_id
    })),
    rows.length ? latestDate(rows) : new Date()
  );
  const confidence = Math.min(
    1,
    result.sampleSize / 8 * 0.6 + result.supplierCount / 4 * 0.4
  );

  return {
    value: result.fairPrice,
    overallMedian: result.overallMedian,
    recentMedian: result.recentMedian,
    mean: result.mean,
    sampleSize: result.sampleSize,
    supplierCount: result.supplierCount,
    method: result.method,
    confidence,
    excludedCount: rows.length - included.length,
    outlierCount: observations.filter(({ outlier }) => outlier).length,
    iqrLow: result.iqrLow,
    iqrHigh: result.iqrHigh,
    filteredMean: result.filteredMean,
    formula:
      result.method === "weighted-median"
        ? "0.70 × overall median + 0.30 × latest-180-day median"
        : result.method === "median"
          ? "Median of comparable, current, arithmetically valid ex-VAT rates"
          : "No comparable observations",
    observations
  };
}

export function sortCatalogSummaries(
  items: CatalogSummary[],
  sortBy: CatalogSortBy,
  sortOrder: SortOrder
): CatalogSummary[] {
  const direction = sortOrder === "asc" ? 1 : -1;
  return [...items].sort((left, right) => {
    let primary = 0;
    if (sortBy === "name") {
      primary = left.name.localeCompare(right.name, undefined, {
        sensitivity: "base"
      });
    } else if (sortBy === "supplierCount") {
      primary = left.supplierCount - right.supplierCount;
    } else {
      if (left.fairPrice === null && right.fairPrice !== null) return 1;
      if (left.fairPrice !== null && right.fairPrice === null) return -1;
      primary = (left.fairPrice ?? 0) - (right.fairPrice ?? 0);
    }

    if (primary !== 0) return primary * direction;
    return left.name.localeCompare(right.name, undefined, {
      sensitivity: "base"
    });
  });
}

export class CatalogService {
  constructor(
    private readonly database: SupabaseClient,
    private readonly tenantId?: string
  ) {}

  async getCategories(): Promise<string[]> {
    const { data, error } = await this.database
      .from("catalog_items")
      .select("category")
      .eq("active", true);

    if (error) throw new Error(`Database error: ${error.message}`);
    if (!data) return [];

    const categories = new Set(data.map((row: { category: string }) => row.category).filter(Boolean));
    return Array.from(categories).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }

  async list(input: CatalogListQuery): Promise<PaginatedCatalogResponse> {
    const pageOffset = (input.page - 1) * input.pageSize;
    let query = this.database
      .from("catalog_items")
      .select(
        "id,name,description,category,canonical_unit,canonical_pricing_basis,attributes"
      )
      .eq("active", true);

    if (input.q) {
      const escaped = input.q.replace(/[%_,()]/g, "").trim();
      if (escaped) {
        query = query.or(`name.ilike.%${escaped}%,description.ilike.%${escaped}%`);
      }
    }
    if (input.category) {
      query = query.eq("category", input.category);
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as CatalogRow[];
    const ids = rows.map(({ id }) => id);
    const [observations, variants] = ids.length
      ? await Promise.all([
          this.observationsFor(ids, input),
          this.variantsFor(ids)
        ])
      : [[], []];
    const summaries = sortCatalogSummaries(
      rows.map((item) => this.summary(item, observations, variants)),
      input.sortBy,
      input.sortOrder
    );
    const items = summaries.slice(pageOffset, pageOffset + input.pageSize);

    return {
      items,
      page: input.page,
      pageSize: input.pageSize,
      total: summaries.length,
      totalPages: Math.ceil(summaries.length / input.pageSize)
    };
  }

  async detail(
    id: string,
    input: CatalogDetailQuery = { variantIds: [] }
  ): Promise<CatalogDetailResponse | null> {
    const { data, error } = await this.database
      .from("catalog_items")
      .select(
        "id,name,description,category,canonical_unit,canonical_pricing_basis,attributes"
      )
      .eq("id", id)
      .eq("active", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const item = data as CatalogRow;
    const [allRows, variantRows] = await Promise.all([
      this.observationsFor([id]),
      this.variantsFor([id])
    ]);
    const selectedVariantIds = new Set(input.variantIds);
    const rows = selectedVariantIds.size
      ? allRows.filter(
          ({ variant_id }) => variant_id && selectedVariantIds.has(variant_id)
        )
      : allRows;
    const variants = this.catalogVariants(id, variantRows, allRows);
    const fairPrice = buildFairPrice(rows);
    return {
      item: {
        id: item.id,
        name: item.name,
        description: item.description,
        category: item.category,
        primaryUnit: item.canonical_unit,
        pricingBasis: item.canonical_pricing_basis,
        attributes: item.attributes ?? {},
        variants
      },
      priceHistory: this.priceHistory(rows),
      supplierComparison: this.supplierComparison(rows),
      fairPrice,
      linkedLineItems: this.linkedItems(rows)
    };
  }

  async unmatched(): Promise<UnmatchedLineItemsResponse> {
    const { data, count, error } = await this.database
      .from("normalized_price_observations")
      .select("*", { count: "exact" })
      .is("catalog_item_id", null)
      .order("quote_date", { ascending: false })
      .limit(100);
    if (error) throw error;
    const rows = (data ?? []) as ObservationRow[];
    return {
      total: count ?? rows.length,
      items: rows.map((row) => ({
        id: row.line_item_id,
        description: row.description_raw,
        supplierName: row.supplier_name,
        quoteNumber: row.quote_number,
        quoteId: row.quote_id,
        date: row.quote_date,
        quantity: Number(row.quantity_raw),
        rawUnit: row.unit_raw,
        rawRate: Number(row.unit_rate_raw),
        taxBasis: row.tax_basis
      }))
    };
  }

  async reassign(id: string, input: ReassignLineItemInput): Promise<ReassignOutcome> {
    const { data: lineItem, error: lineError } = await this.database
      .from("quote_line_items")
      .select("id,unit_raw,unit_rate_ex_vat")
      .eq("id", id)
      .maybeSingle<LineItemForReassignment>();
    if (lineError) throw lineError;
    if (!lineItem) return { status: "line-item-not-found" };

    let targetCatalogItemId = input.targetCatalogItemId;
    let targetVariantId = input.targetVariantId ?? null;
    let targetBasis: string;
    let created = false;
    let createdCatalogItemId: string | null = null;

    if (input.newCatalogItemName) {
      const { data: newItem, error } = await this.database
        .from("catalog_items")
        .insert({
          ...(this.tenantId ? { user_id: this.tenantId } : {}),
          name: input.newCatalogItemName,
          category: "Uncategorised",
          description: "Created by a manual line-item correction.",
          canonical_unit: lineItem.unit_raw,
          canonical_pricing_basis: lineItem.unit_raw,
          attributes: { requiresReview: true }
        })
        .select("id")
        .single<RecordWithId>();
      if (error) throw error;
      targetCatalogItemId = newItem.id;
      targetBasis = lineItem.unit_raw;
      targetVariantId = null;
      created = true;
      createdCatalogItemId = newItem.id;
    } else {
      const { data: target, error } = await this.database
        .from("catalog_items")
        .select("id,canonical_pricing_basis")
        .eq("id", targetCatalogItemId!)
        .eq("active", true)
        .maybeSingle<CatalogBasisRow>();
      if (error) throw error;
      if (!target) return { status: "target-not-found" };
      targetBasis = target.canonical_pricing_basis;
      if (targetVariantId) {
        const { data: variant, error: variantError } = await this.database
          .from("catalog_item_variants")
          .select("id,canonical_pricing_basis")
          .eq("id", targetVariantId)
          .eq("catalog_item_id", target.id)
          .eq("active", true)
          .maybeSingle<VariantBasisRow>();
        if (variantError) throw variantError;
        if (!variant) return { status: "target-not-found" };
        targetBasis = variant.canonical_pricing_basis;
      }
    }

    const normalized = normalizeCatalogRate(
      numberOrNull(lineItem.unit_rate_ex_vat),
      lineItem.unit_raw,
      targetBasis
    );
    const { data: current, error: currentError } = await this.database
      .from("normalized_price_observations")
      .select("catalog_item_id,variant_id")
      .eq("line_item_id", id)
      .maybeSingle<{ catalog_item_id: string | null; variant_id: string | null }>();
    if (currentError) throw currentError;

    const { data: override, error: overrideError } = await this.database
      .from("catalog_match_overrides")
      .insert({
        ...(this.tenantId ? { user_id: this.tenantId } : {}),
        line_item_id: id,
        catalog_item_id: targetCatalogItemId!,
        variant_id: targetVariantId,
        previous_catalog_item_id: current?.catalog_item_id ?? null,
        previous_variant_id: current?.variant_id ?? null,
        reason: created
          ? "Split into a new catalog item in the review UI."
          : "Reassigned in the review UI."
      })
      .select("id")
      .single<RecordWithId>();
    if (overrideError) throw overrideError;

    const { error: normalizationError } = await this.database
      .from("price_normalizations")
      .upsert(
        {
          ...(this.tenantId ? { user_id: this.tenantId } : {}),
          line_item_id: id,
          variant_id: targetVariantId,
          canonical_rate_ex_vat: normalized.canonicalRate,
          canonical_basis: normalized.canonicalBasis,
          estimated: normalized.estimated,
          comparable: normalized.comparable,
          explanation: normalized.explanation,
          normalized_at: new Date().toISOString()
        },
        { onConflict: "line_item_id" }
      );
    if (normalizationError) {
      await this.database.from("catalog_match_overrides").delete().eq("id", override.id);
      if (createdCatalogItemId) {
        await this.database.from("catalog_items").delete().eq("id", createdCatalogItemId);
      }
      throw normalizationError;
    }

    return {
      status: "ok",
      result: {
        lineItemId: id,
        catalogItemId: targetCatalogItemId!,
        created,
        comparable: normalized.comparable,
        canonicalRate: normalized.canonicalRate,
        canonicalBasis: normalized.canonicalBasis
      }
    };
  }

  async stats(): Promise<StatsResponse> {
    const count = async (table: string, activeOnly = false): Promise<number> => {
      let query = this.database
        .from(table)
        .select("*", { count: "exact", head: true });
      if (activeOnly) query = query.eq("active", true);
      const { count: value, error } = await query;
      if (error) throw error;
      return value ?? 0;
    };
    const [totalQuotes, totalLineItems, catalogItemCount, totalSuppliers, first, last] =
      await Promise.all([
        count("quotes"),
        count("quote_line_items"),
        count("catalog_items", true),
        count("suppliers", true),
        this.database
          .from("quotes")
          .select("quote_date")
          .order("quote_date")
          .limit(1)
          .maybeSingle<{ quote_date: string }>(),
        this.database
          .from("quotes")
          .select("quote_date")
          .order("quote_date", { ascending: false })
          .limit(1)
          .maybeSingle<{ quote_date: string }>()
      ]);
    if (first.error) throw first.error;
    if (last.error) throw last.error;
    return {
      totalQuotes,
      totalLineItems,
      catalogItemCount,
      totalSuppliers,
      dateRange: {
        from: first.data?.quote_date ?? null,
        to: last.data?.quote_date ?? null
      }
    };
  }

  async suppliersPerformance(input: SupplierListQuery): Promise<SupplierPerformance[]> {
    const { data: suppliers, error: supplierError } = await this.database
      .from("suppliers")
      .select("id,display_name,email,phone")
      .eq("active", true)
      .order("display_name");
    if (supplierError) throw supplierError;

    let observationQuery = this.database
      .from("normalized_price_observations")
      .select("*");
    if (input.from) observationQuery = observationQuery.gte("quote_date", input.from);
    if (input.to) observationQuery = observationQuery.lte("quote_date", input.to);

    const { data: observations, error: obsError } = await observationQuery;
    if (obsError) throw obsError;

    const rows = filterObservationsByDateRange(
      (observations ?? []) as ObservationRow[],
      input
    );
    const validByCatalogItem = new Map<string, ObservationRow[]>();
    for (const row of rows.filter(validAnalyticsObservation)) {
      if (!row.catalog_item_id) continue;
      validByCatalogItem.set(row.catalog_item_id, [
        ...(validByCatalogItem.get(row.catalog_item_id) ?? []),
        row
      ]);
    }
    const fairPriceByCatalogItem = new Map(
      [...validByCatalogItem.entries()].map(([catalogItemId, itemRows]) => [
        catalogItemId,
        buildFairPrice(itemRows).value
      ])
    );

    return (suppliers ?? []).map((s) => {
      const supplierRows = rows.filter((r) => r.supplier_id === s.id);
      const quotes = new Set(supplierRows.map((r) => r.quote_id));
      const dates = supplierRows.map((r) => r.quote_date).sort();
      const valid = supplierRows.filter(validAnalyticsObservation);

      let varianceSum = 0;
      let varianceCount = 0;

      for (const row of valid) {
        if (!row.catalog_item_id) continue;
        const fairPrice = fairPriceByCatalogItem.get(row.catalog_item_id);
        const rate = numberOrNull(row.canonical_rate_ex_vat)!;
        if (fairPrice && fairPrice > 0) {
          const diffPct = ((rate - fairPrice) / fairPrice) * 100;
          varianceSum += diffPct;
          varianceCount += 1;
        }
      }

      const validRates = valid.map((r) => numberOrNull(r.canonical_rate_ex_vat)!);
      const variancePercent = varianceCount > 0 ? varianceSum / varianceCount : null;
      const totalSpend = supplierRows
        .filter(({ is_current_revision }) => is_current_revision)
        .reduce(
          (sum, row) => sum + (numberOrNull(row.line_total_ex_vat) ?? 0),
          0
        );

      return {
        supplierId: s.id,
        supplierName: s.display_name,
        email: s.email,
        phone: s.phone,
        quoteCount: quotes.size,
        lineItemCount: supplierRows.length,
        firstQuoteDate: dates[0] ?? null,
        lastQuoteDate: dates.at(-1) ?? null,
        averageRate: validRates.length
          ? validRates.reduce((sum, r) => sum + r, 0) / validRates.length
          : 0,
        variancePercent,
        totalSpend,
        competitivenessIndex:
          variancePercent === null ? null : Math.max(0, 100 - variancePercent)
      };
    });
  }

  async supplierProfile(id: string): Promise<SupplierProfileResponse | null> {
    const { data: supplier, error: supplierError } = await this.database
      .from("suppliers")
      .select("id,display_name,email,phone,address,vat_number")
      .eq("id", id)
      .eq("active", true)
      .maybeSingle<{
        id: string;
        display_name: string;
        email: string | null;
        phone: string | null;
        address: string | null;
        vat_number: string | null;
      }>();
    if (supplierError) throw supplierError;
    if (!supplier) return null;

    const { data: quotes, error: quoteError } = await this.database
      .from("quotes")
      .select(
        "id,source_document_id,quote_number,quote_date,event_name,is_current_revision"
      )
      .eq("supplier_id", id)
      .order("quote_date", { ascending: false });
    if (quoteError) throw quoteError;
    const quoteRows = (quotes ?? []) as Array<{
      id: string;
      source_document_id: string;
      quote_number: string;
      quote_date: string;
      event_name: string | null;
      is_current_revision: boolean;
    }>;
    const documentIds = quoteRows.map(({ source_document_id }) => source_document_id);
    const { data: documents, error: documentError } = documentIds.length
      ? await this.database
          .from("source_documents")
          .select("id,filename,storage_path")
          .in("id", documentIds)
      : { data: [], error: null };
    if (documentError) throw documentError;
    const documentRows = (documents ?? []) as Array<{
      id: string;
      filename: string;
      storage_path: string | null;
    }>;

    const { data: observations, error: observationError } = await this.database
      .from("normalized_price_observations")
      .select("*")
      .eq("supplier_id", id)
      .order("quote_date", { ascending: false });
    if (observationError) throw observationError;
    const rows = (observations ?? []) as ObservationRow[];
    const catalogIds = [
      ...new Set(
        rows
          .map(({ catalog_item_id }) => catalog_item_id)
          .filter((value): value is string => Boolean(value))
      )
    ];
    const { data: catalogItems, error: catalogError } = catalogIds.length
      ? await this.database
          .from("catalog_items")
          .select("id,name")
          .in("id", catalogIds)
      : { data: [], error: null };
    if (catalogError) throw catalogError;
    const catalogNames = new Map(
      ((catalogItems ?? []) as Array<{ id: string; name: string }>).map((item) => [
        item.id,
        item.name
      ])
    );
    const performance = (await this.suppliersPerformance({})).find(
      ({ supplierId }) => supplierId === id
    );

    const quoteRecords = await Promise.all(
      quoteRows.map(async (quote) => {
        const document = documentRows.find(
          ({ id: documentId }) => documentId === quote.source_document_id
        );
        const quoteLines = rows.filter(({ quote_id }) => quote_id === quote.id);
        let downloadUrl: string | null = null;
        if (document?.storage_path) {
          const { data } = await this.database.storage
            .from("quote-source-files")
            .createSignedUrl(document.storage_path, 900);
          downloadUrl = data?.signedUrl ?? null;
        }

        return {
          id: quote.id,
          quoteNumber: quote.quote_number,
          quoteDate: quote.quote_date,
          eventName: quote.event_name,
          totalExVat: quoteLines.length
            ? quoteLines.reduce(
                (sum, row) => sum + (numberOrNull(row.line_total_ex_vat) ?? 0),
                0
              )
            : null,
          originalFilename: document?.filename ?? "Source file unavailable",
          sourceDocumentId: quote.source_document_id,
          downloadUrl,
          lines: quoteLines.map((row) => ({
            id: row.line_item_id,
            sourceRow: row.source_row,
            rawDescription: row.description_raw,
            quantity: Number(row.quantity_raw),
            rawUnit: row.unit_raw,
            rawRate: Number(row.unit_rate_raw),
            rawTotal: Number(row.line_total_raw),
            normalizedRate: numberOrNull(row.canonical_rate_ex_vat),
            normalizedBasis: row.canonical_basis,
            catalogItemName: row.catalog_item_id
              ? catalogNames.get(row.catalog_item_id) ?? null
              : null,
            variantLabel: row.variant_label
          }))
        };
      })
    );

    return {
      supplier: {
        id: supplier.id,
        name: supplier.display_name,
        email: supplier.email,
        phone: supplier.phone,
        address: supplier.address,
        vatNumber: supplier.vat_number
      },
      quoteCount: quoteRows.length,
      totalSpend: performance?.totalSpend ?? 0,
      competitivenessIndex: performance?.competitivenessIndex ?? null,
      quotes: quoteRecords
    };
  }

  async ingestionAudit(): Promise<IngestionRunAudit[]> {
    const { data: runs, error: runError } = await this.database
      .from("ingestion_runs")
      .select(
        "id,started_at,completed_at,status,parser_version,matching_version,document_count,error_count"
      )
      .order("started_at", { ascending: false })
      .limit(10);
    if (runError) throw runError;

    const { data: docs, error: docError } = await this.database
      .from("source_documents")
      .select(
        "id,ingestion_run_id,filename,file_type,sha256,extraction_status,extraction_warnings,created_at"
      )
      .order("created_at", { ascending: false });
    if (docError) throw docError;

    const runRows = (runs ?? []) as IngestionRunRow[];
    const documentRows = (docs ?? []) as SourceDocumentAuditRow[];

    return runRows.map((run) => {
      const runDocs = documentRows.filter((d) => d.ingestion_run_id === run.id);
      return {
        id: run.id,
        startedAt: isoTimestamp(run.started_at),
        completedAt: run.completed_at ? isoTimestamp(run.completed_at) : null,
        status: run.status,
        parserVersion: run.parser_version,
        matchingVersion: run.matching_version,
        documentCount: run.document_count ?? runDocs.length,
        errorCount: run.error_count ?? 0,
        documents: runDocs.map((d) => ({
          id: d.id,
          filename: d.filename,
          fileType: d.file_type,
          sha256: d.sha256,
          status: d.extraction_status,
          warnings: stringArray(d.extraction_warnings),
          createdAt: isoTimestamp(d.created_at)
        }))
      };
    });
  }

  async createSupplier(input: CreateSupplierInput): Promise<{ id: string; name: string }> {
    const { data, error } = await this.database
      .from("suppliers")
      .insert({
        ...(this.tenantId ? { user_id: this.tenantId } : {}),
        canonical_name: canonicalSupplierName(input.name),
        display_name: input.name,
        email: input.email || null,
        phone: input.phone || null,
        active: true
      })
      .select("id,display_name")
      .single<{ id: string; display_name: string }>();
    if (error) throw error;
    const supplier = requireData(data, "Creating a supplier");
    return { id: supplier.id, name: supplier.display_name };
  }

  async createCatalogItem(input: CreateCatalogItemInput): Promise<CatalogSummary> {
    const { data, error } = await this.database
      .from("catalog_items")
      .insert({
        ...(this.tenantId ? { user_id: this.tenantId } : {}),
        name: input.name,
        category: input.category || "General",
        description: input.description || null,
        canonical_unit: input.pricingBasis || "item",
        canonical_pricing_basis: input.pricingBasis || "item",
        attributes: {},
        is_base_profile: true,
        active: true
      })
      .select("id,name,description,category,canonical_unit,canonical_pricing_basis,attributes")
      .single<CatalogRow>();
    if (error) throw error;
    return this.summary(requireData(data, "Creating a catalog item"), [], []);
  }

  async deleteSupplier(id: string): Promise<{ success: boolean }> {
    const { data, error } = await this.database
      .from("suppliers")
      .update({ active: false })
      .eq("id", id)
      .select("id")
      .maybeSingle<RecordWithId>();
    if (error) throw error;
    return { success: data !== null };
  }

  async deleteCatalogItem(id: string): Promise<{ success: boolean }> {
    const { data, error } = await this.database
      .from("catalog_items")
      .update({ active: false })
      .eq("id", id)
      .select("id")
      .maybeSingle<RecordWithId>();
    if (error) throw error;
    return { success: data !== null };
  }

  private async observationsFor(
    catalogItemIds: string[],
    range: DateRangeQuery = {}
  ): Promise<ObservationRow[]> {
    let query = this.database
      .from("normalized_price_observations")
      .select("*")
      .in("catalog_item_id", catalogItemIds);
    if (range.from) query = query.gte("quote_date", range.from);
    if (range.to) query = query.lte("quote_date", range.to);

    const { data, error } = await query.order("quote_date");
    if (error) throw error;
    return filterObservationsByDateRange(
      (data ?? []) as ObservationRow[],
      range
    );
  }
  private async variantsFor(
    catalogItemIds: string[]
  ): Promise<CatalogVariantRow[]> {
    if (catalogItemIds.length === 0) return [];
    const { data, error } = await this.database
      .from("catalog_item_variants")
      .select(
        "id,catalog_item_id,label,attributes,canonical_unit,canonical_pricing_basis"
      )
      .in("catalog_item_id", catalogItemIds)
      .eq("active", true)
      .order("label");
    if (error) throw error;
    return (data ?? []) as CatalogVariantRow[];
  }

  private catalogVariants(
    catalogItemId: string,
    variants: CatalogVariantRow[],
    observations: ObservationRow[]
  ): CatalogVariant[] {
    return variants
      .filter((variant) => variant.catalog_item_id === catalogItemId)
      .map((variant) => ({
        id: variant.id,
        label: variant.label,
        attributes: Object.fromEntries(
          Object.entries(variant.attributes ?? {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        ),
        primaryUnit: variant.canonical_unit,
        pricingBasis: variant.canonical_pricing_basis,
        observationCount: observations.filter(
          ({ variant_id }) => variant_id === variant.id
        ).length
      }));
  }

  private summary(
    item: CatalogRow,
    allRows: ObservationRow[],
    allVariants: CatalogVariantRow[]
  ): CatalogSummary {
    const rows = allRows.filter(({ catalog_item_id }) => catalog_item_id === item.id);
    const valid = rows.filter(validAnalyticsObservation);
    const rates = valid.map((row) => numberOrNull(row.canonical_rate_ex_vat)!);
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      category: item.category,
      primaryUnit: item.canonical_pricing_basis,
      linkedLineItemCount: rows.length,
      supplierCount: new Set(rows.map(({ supplier_id }) => supplier_id)).size,
      minPrice: rates.length ? Math.min(...rates) : null,
      maxPrice: rates.length ? Math.max(...rates) : null,
      fairPrice: buildFairPrice(rows).value,
      lastUploadedAt: (() => {
        const last = rows
          .map(({ source_created_at }) => source_created_at)
          .filter(Boolean)
          .sort()
          .at(-1);
        return last ? isoTimestamp(last) : null;
      })(),
      variants: this.catalogVariants(item.id, allVariants, rows)
    };
  }

  private priceHistory(rows: ObservationRow[]): PriceHistoryPoint[] {
    return rows
      .filter(validAnalyticsObservation)
      .map((row) => ({
        date: row.quote_date,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        rate: numberOrNull(row.canonical_rate_ex_vat)!,
        rawRate: Number(row.unit_rate_raw),
        unit: row.canonical_basis ?? row.unit_raw,
        total: Number(row.line_total_raw),
        quoteNumber: row.quote_number,
        quoteId: row.quote_id,
        estimated: row.estimated ?? false,
        variantId: row.variant_id,
        variantLabel: row.variant_label ?? "Base profile"
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private supplierComparison(rows: ObservationRow[]): SupplierComparison[] {
    const groups = new Map<string, ObservationRow[]>();
    for (const row of rows.filter(validAnalyticsObservation)) {
      groups.set(row.supplier_id, [...(groups.get(row.supplier_id) ?? []), row]);
    }
    return [...groups.entries()]
      .map(([supplierId, supplierRows]) => {
        const sorted = supplierRows.sort((a, b) => a.quote_date.localeCompare(b.quote_date));
        const rates = sorted.map((row) => numberOrNull(row.canonical_rate_ex_vat)!);
        const last = sorted.at(-1)!;
        return {
          supplierId,
          supplierName: last.supplier_name,
          averageRate: rates.reduce((sum, rate) => sum + rate, 0) / rates.length,
          minRate: Math.min(...rates),
          maxRate: Math.max(...rates),
          lastQuotedRate: rates.at(-1)!,
          lastQuoteDate: last.quote_date,
          quoteCount: sorted.length,
          primaryUnit: last.canonical_basis ?? last.unit_raw
        };
      })
      .sort((a, b) => a.averageRate - b.averageRate);
  }

  private linkedItems(rows: ObservationRow[]): LinkedLineItem[] {
    return rows.map((row) => ({
      id: row.line_item_id,
      description: row.description_raw,
      supplierName: row.supplier_name,
      quoteNumber: row.quote_number,
      quoteId: row.quote_id,
      date: row.quote_date,
      quantity: Number(row.quantity_raw),
      rawUnit: row.unit_raw,
      rawRate: Number(row.unit_rate_raw),
      normalizedRate: numberOrNull(row.canonical_rate_ex_vat),
      normalizedUnit: row.canonical_basis,
      estimated: row.estimated ?? false,
      comparable: row.comparable ?? false,
      arithmeticValid: row.arithmetic_valid,
      taxBasis: row.tax_basis
    }));
  }
}

function isoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Database returned an invalid timestamp: ${value}`);
  }
  return timestamp.toISOString();
}
