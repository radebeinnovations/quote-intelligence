import {
  calculateFairPrice,
  normalizeCatalogRate,
  type CatalogDetailResponse,
  type CatalogSummary,
  type CreateCatalogItemInput,
  type CreateSupplierInput,
  type DateRangeQuery,
  type FairPriceDetail,
  type IngestionRunAudit,
  type LinkedLineItem,
  type PaginatedCatalogResponse,
  type PriceHistoryPoint,
  type ReassignLineItemInput,
  type ReassignLineItemResult,
  type StatsResponse,
  type SupplierAnalytics,
  type UnmatchedLineItemsResponse,
  type SupplierComparison
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

interface LineItemForReassignment {
  id: string;
  unit_raw: string;
  unit_rate_ex_vat: number | string | null;
}

interface CatalogBasisRow {
  id: string;
  canonical_pricing_basis: string;
}

interface RecordWithId {
  id: string;
}

interface SupplierRow {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
}

interface QuoteSummaryRow {
  supplier_id: string;
  quote_date: string;
}

interface IngestionDocumentRow {
  id: string;
  filename: string;
  file_type: string;
  sha256: string;
  extraction_status: string;
  extraction_warnings: unknown;
  created_at: string;
}

interface IngestionRunRow {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  parser_version: string;
  matching_version: string;
  document_count: number;
  error_count: number;
  source_documents: IngestionDocumentRow[] | null;
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
  description_raw: string;
  quantity_raw: number | string;
  unit_raw: string;
  unit_rate_raw: number | string;
  line_total_raw: number | string;
  tax_basis: "inclusive" | "exclusive" | "unknown";
  unit_rate_ex_vat: number | string | null;
  canonical_rate_ex_vat: number | string | null;
  canonical_basis: string | null;
  estimated: boolean | null;
  comparable: boolean | null;
  explanation: string | null;
  arithmetic_valid: boolean;
  validation_status: "valid" | "warning" | "invalid";
  source_created_at: string;
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

type CatalogSortKey = "fairPrice" | "supplierCount";
type SortOrder = "asc" | "desc";

export function sortCatalogSummaries(
  items: CatalogSummary[],
  sortBy: CatalogSortKey,
  sortOrder: SortOrder
): CatalogSummary[] {
  return [...items].sort((left, right) => {
    const leftValue = left[sortBy];
    const rightValue = right[sortBy];

    if (leftValue === null) return rightValue === null ? left.name.localeCompare(right.name) : 1;
    if (rightValue === null) return -1;

    const difference = leftValue - rightValue;
    if (difference !== 0) return sortOrder === "asc" ? difference : -difference;
    return left.name.localeCompare(right.name);
  });
}

function validAnalyticsObservation(row: ObservationRow): boolean {
  return (
    row.is_current_revision &&
    row.arithmetic_valid &&
    row.comparable === true &&
    numberOrNull(row.canonical_rate_ex_vat) !== null
  );
}

function latestDate(rows: ObservationRow[]): Date {
  const timestamps = rows
    .map(({ quote_date }) => Date.parse(quote_date))
    .filter(Number.isFinite);
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
    formula:
      result.method === "weighted-median"
        ? "0.70 × overall median + 0.30 × latest-180-day median"
        : result.method === "median"
          ? "Median of comparable, current, arithmetically valid ex-VAT rates"
          : "No comparable observations",
    observations
  };
}

export class CatalogService {
  constructor(private readonly database: SupabaseClient) {}

  async list(input: {
    query: string;
    page: number;
    pageSize: number;
  }): Promise<PaginatedCatalogResponse> {
    const from = (input.page - 1) * input.pageSize;
    const to = from + input.pageSize - 1;
    let query = this.database
      .from("catalog_items")
      .select(
        "id,name,description,category,canonical_unit,canonical_pricing_basis,attributes",
        { count: "exact" }
      )
      .eq("active", true)
      .order("name")
      .range(from, to);

    if (input.query) {
      const escaped = input.query.replace(/[%_,()]/g, "");
      query = query.or(`name.ilike.%${escaped}%,description.ilike.%${escaped}%`);
    }

    const { data, count, error } = await query;
    if (error) throw error;
    const items = (data ?? []) as CatalogRow[];
    const ids = items.map(({ id }) => id);
    const observations = ids.length ? await this.observationsFor(ids) : [];

    return {
      items: items.map((item) => this.summary(item, observations)),
      page: input.page,
      pageSize: input.pageSize,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / input.pageSize)
    };
  }

  async detail(id: string): Promise<CatalogDetailResponse | null> {
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
    const rows = await this.observationsFor([id]);
    const fairPrice = buildFairPrice(rows);
    return {
      item: {
        id: item.id,
        name: item.name,
        description: item.description,
        category: item.category,
        primaryUnit: item.canonical_unit,
        pricingBasis: item.canonical_pricing_basis,
        attributes: item.attributes ?? {}
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
    let targetBasis: string;
    let created = false;
    let createdCatalogItemId: string | null = null;

    if (input.newCatalogItemName) {
      const { data: newItem, error } = await this.database
        .from("catalog_items")
        .insert({
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
      const createdItem = requireData(newItem, "Creating a catalog item for reassignment");
      targetCatalogItemId = createdItem.id;
      targetBasis = lineItem.unit_raw;
      created = true;
      createdCatalogItemId = createdItem.id;
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
    }

    const normalized = normalizeCatalogRate(
      numberOrNull(lineItem.unit_rate_ex_vat),
      lineItem.unit_raw,
      targetBasis
    );
    const { data: current, error: currentError } = await this.database
      .from("normalized_price_observations")
      .select("catalog_item_id")
      .eq("line_item_id", id)
      .maybeSingle<{ catalog_item_id: string | null }>();
    if (currentError) throw currentError;

    const { data: override, error: overrideError } = await this.database
      .from("catalog_match_overrides")
      .insert({
        line_item_id: id,
        catalog_item_id: targetCatalogItemId!,
        previous_catalog_item_id: current?.catalog_item_id ?? null,
        reason: created
          ? "Split into a new catalog item in the review UI."
          : "Reassigned in the review UI."
      })
      .select("id")
      .single<RecordWithId>();
    if (overrideError) throw overrideError;
    const storedOverride = requireData(override, "Creating a catalog override");

    const { error: normalizationError } = await this.database
      .from("price_normalizations")
      .upsert(
        {
          line_item_id: id,
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
      await this.database.from("catalog_match_overrides").delete().eq("id", storedOverride.id);
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

  async suppliers(range: DateRangeQuery): Promise<SupplierAnalytics[]> {
    const [supplierResult, quoteResult] = await Promise.all([
      this.database
        .from("suppliers")
        .select("id,display_name,email,phone")
        .eq("active", true)
        .order("display_name"),
      this.dateFilteredQuery(
        this.database.from("quotes").select("supplier_id,quote_date"),
        range,
        "quote_date"
      )
    ]);
    if (supplierResult.error) throw supplierResult.error;
    if (quoteResult.error) throw quoteResult.error;

    const suppliers = (supplierResult.data ?? []) as SupplierRow[];
    const quotes = (quoteResult.data ?? []) as QuoteSummaryRow[];
    let observationQuery = this.database
      .from("normalized_price_observations")
      .select("*")
      .eq("is_current_revision", true);
    observationQuery = this.dateFilteredQuery(observationQuery, range, "quote_date");
    const { data: observationData, error: observationError } = await observationQuery;
    if (observationError) throw observationError;
    const observations = (observationData ?? []) as ObservationRow[];

    const marketRates = new Map<string, number>();
    const catalogIds = [
      ...new Set(
        observations
          .filter(validAnalyticsObservation)
          .map(({ catalog_item_id }) => catalog_item_id)
          .filter((id): id is string => id !== null)
      )
    ];
    for (const catalogId of catalogIds) {
      const rows = observations.filter(({ catalog_item_id }) => catalog_item_id === catalogId);
      const fairPrice = buildFairPrice(rows).value;
      if (fairPrice !== null && fairPrice !== 0) marketRates.set(catalogId, fairPrice);
    }

    return suppliers.map((supplier) => {
      const supplierQuotes = quotes.filter(({ supplier_id }) => supplier_id === supplier.id);
      const supplierRows = observations.filter(
        ({ supplier_id }) => supplier_id === supplier.id
      );
      const comparableRates = supplierRows
        .filter(validAnalyticsObservation)
        .map((row) => numberOrNull(row.canonical_rate_ex_vat)!)
        .filter(Number.isFinite);
      const variances = supplierRows.flatMap((row) => {
        if (!validAnalyticsObservation(row) || !row.catalog_item_id) return [];
        const marketRate = marketRates.get(row.catalog_item_id);
        const rate = numberOrNull(row.canonical_rate_ex_vat);
        return marketRate && rate !== null ? [(rate / marketRate - 1) * 100] : [];
      });
      const dates = supplierQuotes.map(({ quote_date }) => quote_date).sort();

      return {
        supplierId: supplier.id,
        supplierName: supplier.display_name,
        email: supplier.email,
        phone: supplier.phone,
        quoteCount: supplierQuotes.length,
        lineItemCount: supplierRows.length,
        averageRate: comparableRates.length
          ? comparableRates.reduce((sum, rate) => sum + rate, 0) / comparableRates.length
          : null,
        variancePercent: variances.length
          ? variances.reduce((sum, variance) => sum + variance, 0) / variances.length
          : null,
        firstQuoteDate: dates[0] ?? null,
        lastQuoteDate: dates.at(-1) ?? null
      };
    });
  }

  async ingestionAudit(): Promise<IngestionRunAudit[]> {
    const { data, error } = await this.database
      .from("ingestion_runs")
      .select(
        "id,started_at,completed_at,status,parser_version,matching_version,document_count,error_count,source_documents(id,filename,file_type,sha256,extraction_status,extraction_warnings,created_at)"
      )
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    return ((data ?? []) as IngestionRunRow[]).map((run) => ({
      id: run.id,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      status: run.status,
      parserVersion: run.parser_version,
      matchingVersion: run.matching_version,
      documentCount: run.document_count,
      errorCount: run.error_count,
      documents: (Array.isArray(run.source_documents) ? run.source_documents : []).map((document) => ({
        id: document.id,
        filename: document.filename,
        fileType: document.file_type,
        sha256: document.sha256,
        status: document.extraction_status,
        warnings: document.extraction_warnings,
        createdAt: document.created_at
      }))
    }));
  }

  async createSupplier(input: CreateSupplierInput): Promise<{ id: string; name: string }> {
    const { data, error } = await this.database
      .from("suppliers")
      .insert({
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
        name: input.name,
        category: input.category || "General",
        description: input.description || null,
        canonical_unit: input.pricingBasis || "item",
        canonical_pricing_basis: input.pricingBasis || "item",
        attributes: {},
        active: true
      })
      .select("id,name,description,category,canonical_unit,canonical_pricing_basis,attributes")
      .single<CatalogRow>();
    if (error) throw error;
    return this.summary(requireData(data, "Creating a catalog item"), []);
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

  private dateFilteredQuery<T extends {
    gte(column: string, value: string): T;
    lte(column: string, value: string): T;
  }>(query: T, range: DateRangeQuery, column: string): T {
    let filtered = query;
    if (range.from) filtered = filtered.gte(column, range.from);
    if (range.to) filtered = filtered.lte(column, range.to);
    return filtered;
  }

  private async observationsFor(catalogItemIds: string[]): Promise<ObservationRow[]> {
    const { data, error } = await this.database
      .from("normalized_price_observations")
      .select("*")
      .in("catalog_item_id", catalogItemIds)
      .order("quote_date");
    if (error) throw error;
    return (data ?? []) as ObservationRow[];
  }

  private summary(item: CatalogRow, allRows: ObservationRow[]): CatalogSummary {
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
      lastUploadedAt: rows
        .map(({ source_created_at }) => source_created_at)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null
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
        estimated: row.estimated ?? false
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
