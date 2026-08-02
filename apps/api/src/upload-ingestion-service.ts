import {
  extractedDocumentSchema,
  findCatalogRule,
  nearlyEqual,
  normalizeCatalogRate,
  normalizeToExVat,
  validateExtractedDocument,
  type CatalogRule,
  type ExtractedDocument,
  type UploadQuoteResponse,
  type UploadedCatalogMatch,
  type UploadedQuoteLineItem
} from "@quote-intelligence/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeUnknownError, isDatabaseError } from "./error-utils";
import { createHash } from "node:crypto";
import { DocuPipeBufferClient } from "./docupipe-buffer-client";
import { parseSouthAfricanDate } from "./quote-date";
import { parseXlsxQuoteBuffer } from "./xlsx-buffer-parser";

const PARSER_VERSION = "upload-1.0.0";
const MATCHING_VERSION = "catalog-rules-1.0.0";

export type UploadFileType = "pdf" | "xlsx";

export interface UploadIngestionInput {
  filename: string;
  fileType: UploadFileType;
  contents: Uint8Array;
}

export interface UploadIngestionApi {
  ingest(input: UploadIngestionInput): Promise<UploadQuoteResponse>;
}

export class UploadIngestionError extends Error {
  constructor(message: string, readonly statusCode = 422) {
    super(message);
    this.name = "UploadIngestionError";
  }
}

interface RecordWithId { id: string }

interface ExistingSourceRow {
  id: string;
  filename: string;
  extraction_status: string;
  raw_extraction: unknown;
  extraction_warnings: unknown;
}

interface QuoteRow {
  id: string;
  supplier_id: string;
  quote_number: string;
  quote_date: string;
  currency: string;
  total_raw: number | string | null;
}

interface SupplierRow { id: string; display_name: string }

interface LineRow {
  id: string;
  source_row: string | null;
  description_raw: string;
  quantity_raw: number | string;
  unit_raw: string;
  unit_rate_raw: number | string;
  line_total_raw: number | string;
  unit_rate_ex_vat: number | string | null;
}

interface MatchRow {
  line_item_id: string;
  catalog_item_id: string | null;
  status: "matched" | "review" | "unmatched";
  confidence: number | string | null;
}

interface CatalogNameRow { id: string; name: string }

function requireData<T>(data: T | null, operation: string): T {
  if (data === null) {
    throw new UploadIngestionError(`${operation} returned no database row.`, 500);
  }
  return data;
}

function stringWarnings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((warning): warning is string => typeof warning === "string")
    : [];
}

function inferRevision(quoteNumber: string): number {
  const match = quoteNumber.match(/\(rev(?:ision)?\s*(\d+)\)/i);
  return match?.[1] ? Number(match[1]) : 0;
}

function canonicalSupplierName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b\(pty\)|\bltd\b|\bcc\b|[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function safeFilename(filename: string): string {
  return (
    filename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "quote-upload"
  );
}

export class UploadIngestionService implements UploadIngestionApi {
  constructor(
    private readonly database: SupabaseClient,
    private readonly userId: string
  ) {}

  async ingest(input: UploadIngestionInput): Promise<UploadQuoteResponse> {
    const sha256 = createHash("sha256").update(input.contents).digest("hex");
    const existing = await this.findSourceDocument(sha256);
    if (existing?.extraction_status === "parsed") {
      const parsedDocument = extractedDocumentSchema.safeParse(existing.raw_extraction);
      if (!parsedDocument.success) {
        throw new UploadIngestionError(
          "The stored extraction for this document is invalid and must be reprocessed.",
          500
        );
      }
      const document = parsedDocument.data;
      return this.loadSummary({
        sourceDocumentId: existing.id,
        filename: existing.filename,
        sha256,
        document,
        warnings: stringWarnings(existing.extraction_warnings),
        idempotent: true
      });
    }
    if (existing?.extraction_status === "processing") {
      throw new UploadIngestionError("This document is already being processed.", 409);
    }

    const ingestionRunId = await this.startRun();
    let sourceDocumentId: string | null = null;
    try {
      sourceDocumentId = existing
        ? await this.retrySourceDocument(existing.id)
        : await this.createSourceDocument(ingestionRunId, input, sha256);

      const document = await this.parse(input);
      const normalizedDate = parseSouthAfricanDate(document.quote.dateText);
      const warnings = [
        ...document.extractionWarnings,
        ...validateExtractedDocument(document).map(({ message }) => message)
      ];
      if (document.quote.taxBasis === "unknown") {
        warnings.push("Tax basis is unknown; extracted rates are excluded from comparable analytics.");
      }

      await this.database
        .from("source_documents")
        .update({ raw_extraction: document, extraction_warnings: warnings })
        .eq("id", sourceDocumentId)
        .throwOnError();

      const supplierId = await this.upsertSupplier(document);
      const quoteId = await this.insertQuote(
        sourceDocumentId,
        supplierId,
        document,
        normalizedDate,
        warnings
      );
      const lines = await this.insertLineItems(quoteId, document);
      const matches = await this.matchLineItems(lines);

      await this.database
        .from("source_documents")
        .update({ extraction_status: "parsed" })
        .eq("id", sourceDocumentId)
        .throwOnError();
      await this.finishRun(ingestionRunId, 0);

      return {
        idempotent: false,
        sha256,
        filename: input.filename,
        supplier: { id: supplierId, name: document.supplier.name },
        quote: {
          id: quoteId,
          quoteNumber: document.quote.quoteNumber,
          quoteDate: normalizedDate,
          currency: document.quote.currency,
          total: document.quote.total ?? null
        },
        lineItems: lines.map((line, index) => ({
          id: line.id,
          sourceRow: line.source_row,
          description: line.description_raw,
          quantity: Number(line.quantity_raw),
          unit: line.unit_raw,
          unitRate: Number(line.unit_rate_raw),
          lineTotal: Number(line.line_total_raw),
          match: matches[index] ?? {
            catalogItemId: null,
            catalogItemName: null,
            status: "unmatched",
            confidence: null
          }
        })),
        warnings
      };
    } catch (error) {
      const message = describeUnknownError(error);
      if (sourceDocumentId) {
        await Promise.allSettled([
          this.database.from("quotes").delete().eq("source_document_id", sourceDocumentId),
          this.database
            .from("source_documents")
            .update({ extraction_status: "failed", extraction_warnings: [message] })
            .eq("id", sourceDocumentId)
        ]);
      }
      await this.finishRun(ingestionRunId, 1).catch(() => undefined);
      if (error instanceof UploadIngestionError) throw error;
      const statusCode = isDatabaseError(error) ? 500 : 422;
      throw new UploadIngestionError(
        `Unable to parse and persist the uploaded quote: ${message}`,
        statusCode
      );
    }
  }

  private async parse(input: UploadIngestionInput): Promise<ExtractedDocument> {
    if (input.fileType === "xlsx") return parseXlsxQuoteBuffer(input.contents);
    const apiKey = process.env.DOCUPIPE_API_KEY;
    const parseEndpoint = process.env.DOCUPIPE_PARSE_ENDPOINT;
    if (!apiKey || !parseEndpoint) {
      throw new UploadIngestionError(
        "PDF parsing is unavailable until DOCUPIPE_API_KEY and DOCUPIPE_PARSE_ENDPOINT are configured.",
        503
      );
    }
    const client = new DocuPipeBufferClient({
      apiKey,
      parseEndpoint,
      ...(process.env.DOCUPIPE_SCHEMA_ID ? { schemaId: process.env.DOCUPIPE_SCHEMA_ID } : {})
    });
    return client.parsePdf(input.contents, input.filename);
  }

  private async findSourceDocument(sha256: string): Promise<ExistingSourceRow | null> {
    const { data, error } = await this.database
      .from("source_documents")
      .select("id,filename,extraction_status,raw_extraction,extraction_warnings")
      .eq("user_id", this.userId)
      .eq("sha256", sha256)
      .maybeSingle<ExistingSourceRow>();
    if (error) throw error;
    return data;
  }

  private async startRun(): Promise<string> {
    const { data, error } = await this.database
      .from("ingestion_runs")
      .insert({
        user_id: this.userId,
        parser_version: PARSER_VERSION,
        matching_version: MATCHING_VERSION,
        document_count: 1
      })
      .select("id")
      .single<RecordWithId>();
    if (error) throw error;
    return requireData(data, "Creating an ingestion run").id;
  }

  private async finishRun(runId: string, errorCount: number): Promise<void> {
    const { error } = await this.database
      .from("ingestion_runs")
      .update({
        completed_at: new Date().toISOString(),
        error_count: errorCount,
        status: errorCount ? "completed_with_errors" : "completed"
      })
      .eq("id", runId);
    if (error) throw error;
  }

  private async createSourceDocument(
    ingestionRunId: string,
    input: UploadIngestionInput,
    sha256: string
  ): Promise<string> {
    const storagePath = `${this.userId}/${ingestionRunId}/${safeFilename(input.filename)}`;
    const { error: storageError } = await this.database.storage
      .from("quote-source-files")
      .upload(storagePath, input.contents, {
        contentType:
          input.fileType === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false
      });
    if (storageError) throw storageError;
    const { data, error } = await this.database
      .from("source_documents")
      .insert({
        user_id: this.userId,
        ingestion_run_id: ingestionRunId,
        filename: input.filename,
        file_type: input.fileType,
        sha256,
        storage_path: storagePath,
        extraction_status: "processing"
      })
      .select("id")
      .single<RecordWithId>();
    if (error) {
      await this.database.storage.from("quote-source-files").remove([storagePath]);
      throw error;
    }
    return requireData(data, "Creating a source document").id;
  }

  private async retrySourceDocument(
    sourceDocumentId: string
  ): Promise<string> {
    const { error } = await this.database
      .from("source_documents")
      .update({
        extraction_status: "processing",
        extraction_warnings: []
      })
      .eq("id", sourceDocumentId);
    if (error) throw error;
    return sourceDocumentId;
  }

  private async upsertSupplier(document: ExtractedDocument): Promise<string> {
    const supplier = document.supplier;
    const values = {
      user_id: this.userId,
      canonical_name: canonicalSupplierName(supplier.name),
      display_name: supplier.name,
      vat_number: supplier.vatNumber ?? null,
      email: supplier.email ?? null,
      phone: supplier.phone ?? null,
      address: supplier.address ?? null,
      active: true
    };
    if (supplier.vatNumber) {
      const { data, error } = await this.database
        .from("suppliers")
        .upsert(values, { onConflict: "user_id,vat_number" })
        .select("id")
        .single<RecordWithId>();
      if (error) throw error;
      return requireData(data, "Upserting a supplier").id;
    }

    const { data: existing, error: selectError } = await this.database
      .from("suppliers")
      .select("id")
      .eq("user_id", this.userId)
      .eq("canonical_name", values.canonical_name)
      .maybeSingle<RecordWithId>();
    if (selectError) throw selectError;
    if (existing) {
      const { error: updateError } = await this.database
        .from("suppliers")
        .update(values)
        .eq("id", existing.id);
      if (updateError) throw updateError;
      return existing.id;
    }

    const { data, error } = await this.database
      .from("suppliers")
      .insert(values)
      .select("id")
      .single<RecordWithId>();
    if (error) throw error;
    return requireData(data, "Creating a supplier").id;
  }

  private async insertQuote(
    sourceDocumentId: string,
    supplierId: string,
    document: ExtractedDocument,
    normalizedDate: string,
    warnings: string[]
  ): Promise<string> {
    const quote = document.quote;
    const quoteNumber = quote.quoteNumber.replace(/\s*\(rev(?:ision)?\s*\d+\)\s*$/i, "");
    const { data, error } = await this.database
      .from("quotes")
      .insert({
        user_id: this.userId,
        source_document_id: sourceDocumentId,
        supplier_id: supplierId,
        quote_number: quoteNumber,
        revision_number: quote.revisionNumber ?? inferRevision(quote.quoteNumber),
        is_current_revision: false,
        quote_date: normalizedDate,
        event_name: quote.eventName ?? null,
        currency: quote.currency,
        vat_rate: quote.vatRate,
        tax_basis: quote.taxBasis,
        subtotal_raw: quote.subtotal ?? null,
        vat_amount_raw: quote.vatAmount ?? null,
        total_raw: quote.total ?? null,
        validation_status: warnings.length ? "warning" : "valid",
        validation_warnings: warnings
      })
      .select("id")
      .single<RecordWithId>();
    if (error) throw error;
    await this.reconcileRevisions(supplierId, quoteNumber);
    return requireData(data, "Creating a quote").id;
  }

  private async reconcileRevisions(supplierId: string, quoteNumber: string): Promise<void> {
    const { data, error } = await this.database
      .from("quotes")
      .select("id,revision_number")
      .eq("supplier_id", supplierId)
      .eq("quote_number", quoteNumber)
      .order("revision_number", { ascending: false });
    if (error) throw error;
    const revisions = (data ?? []) as Array<{ id: string; revision_number: number }>;
    const current = revisions[0];
    if (!current) return;

    await this.database
      .from("quotes")
      .update({ is_current_revision: false })
      .eq("supplier_id", supplierId)
      .eq("quote_number", quoteNumber)
      .throwOnError();
    await this.database
      .from("quotes")
      .update({
        is_current_revision: true,
        supersedes_quote_id: revisions[1]?.id ?? null
      })
      .eq("id", current.id)
      .throwOnError();
  }

  private async insertLineItems(quoteId: string, document: ExtractedDocument): Promise<LineRow[]> {
    const rows = document.lineItems.map((item) => {
      const unitRate = normalizeToExVat(item.unitRate, document.quote.taxBasis, document.quote.vatRate);
      const lineTotal = normalizeToExVat(item.lineTotal, document.quote.taxBasis, document.quote.vatRate);
      return {
        user_id: this.userId,
        quote_id: quoteId,
        source_row: item.sourceRow ?? null,
        description_raw: item.description,
        quantity_raw: item.quantity,
        unit_raw: item.unit,
        unit_rate_raw: item.unitRate,
        line_total_raw: item.lineTotal,
        currency: document.quote.currency,
        tax_basis: document.quote.taxBasis,
        unit_rate_ex_vat: unitRate.amountExVat,
        line_total_ex_vat: lineTotal.amountExVat,
        arithmetic_valid: nearlyEqual(item.quantity * item.unitRate, item.lineTotal),
        normalization_status: unitRate.amountExVat === null ? "not_comparable" : "normalized",
        normalization_warnings: unitRate.amountExVat === null ? [unitRate.reason] : []
      };
    });
    const { data, error } = await this.database
      .from("quote_line_items")
      .insert(rows)
      .select("id,source_row,description_raw,quantity_raw,unit_raw,unit_rate_raw,line_total_raw,unit_rate_ex_vat");
    if (error) throw error;
    const inserted = (data ?? []) as LineRow[];
    if (inserted.length !== rows.length) {
      throw new UploadIngestionError(
        `The database returned ${inserted.length} of ${rows.length} inserted quote lines.`,
        500
      );
    }
    return inserted;
  }

  private async matchLineItems(lines: LineRow[]): Promise<UploadedCatalogMatch[]> {
    const catalogCache = new Map<string, string>();
    const matches: UploadedCatalogMatch[] = [];
    for (const line of lines) {
      const rule = findCatalogRule(line.description_raw);
      if (!rule) {
        await this.database.from("catalog_matches").insert({
          user_id: this.userId,
          line_item_id: line.id,
          catalog_item_id: null,
          status: "unmatched",
          method: null,
          confidence: null,
          reason_codes: ["NO_CONSERVATIVE_RULE"]
        }).throwOnError();
        matches.push({
          catalogItemId: null,
          catalogItemName: null,
          status: "unmatched",
          confidence: null
        });
        continue;
      }

      let catalogItemId = catalogCache.get(rule.name);
      if (!catalogItemId) {
        catalogItemId = await this.upsertCatalogItem(rule);
        catalogCache.set(rule.name, catalogItemId);
      }
      const normalized = normalizeCatalogRate(
        line.unit_rate_ex_vat === null ? null : Number(line.unit_rate_ex_vat),
        line.unit_raw,
        rule.canonicalBasis
      );
      await this.database.from("catalog_matches").insert({
        user_id: this.userId,
        line_item_id: line.id,
        catalog_item_id: catalogItemId,
        status: "matched",
        method: "exact_rule",
        confidence: 0.98,
        reason_codes: ["ALIASED_DESCRIPTION", "PROTECTED_ATTRIBUTES_COMPATIBLE"]
      }).throwOnError();
      await this.database.from("price_normalizations").insert({
        user_id: this.userId,
        line_item_id: line.id,
        canonical_rate_ex_vat: normalized.canonicalRate,
        canonical_basis: normalized.canonicalBasis,
        estimated: normalized.estimated,
        comparable: normalized.comparable,
        explanation: normalized.explanation
      }).throwOnError();
      matches.push({
        catalogItemId,
        catalogItemName: rule.name,
        status: "matched",
        confidence: 0.98
      });
    }
    return matches;
  }

  private async upsertCatalogItem(rule: CatalogRule): Promise<string> {
    const { data, error } = await this.database
      .from("catalog_items")
      .upsert({
        user_id: this.userId,
        name: rule.name,
        category: rule.category,
        description: rule.description,
        canonical_unit: rule.canonicalUnit,
        canonical_pricing_basis: rule.canonicalBasis,
        attributes: { generatedBy: MATCHING_VERSION },
        active: true
      }, { onConflict: "user_id,name" })
      .select("id")
      .single<RecordWithId>();
    if (error) throw error;
    return requireData(data, "Upserting a catalog item").id;
  }

  private async loadSummary(input: {
    sourceDocumentId: string;
    filename: string;
    sha256: string;
    document: ExtractedDocument;
    warnings: string[];
    idempotent: boolean;
  }): Promise<UploadQuoteResponse> {
    const { data: quote, error: quoteError } = await this.database
      .from("quotes")
      .select("id,supplier_id,quote_number,quote_date,currency,total_raw")
      .eq("source_document_id", input.sourceDocumentId)
      .single<QuoteRow>();
    if (quoteError) throw quoteError;
    const storedQuote = requireData(quote, "Loading the uploaded quote");
    const { data: supplier, error: supplierError } = await this.database
      .from("suppliers")
      .select("id,display_name")
      .eq("id", storedQuote.supplier_id)
      .single<SupplierRow>();
    if (supplierError) throw supplierError;
    const storedSupplier = requireData(supplier, "Loading the quote supplier");
    const { data: lineData, error: lineError } = await this.database
      .from("quote_line_items")
      .select("id,source_row,description_raw,quantity_raw,unit_raw,unit_rate_raw,line_total_raw,unit_rate_ex_vat")
      .eq("quote_id", storedQuote.id)
      .order("created_at", { ascending: true });
    if (lineError) throw lineError;
    const lines = (lineData ?? []) as LineRow[];
    const lineIds = lines.map(({ id }) => id);
    const matchRows = lineIds.length
      ? await this.database
          .from("catalog_matches")
          .select("line_item_id,catalog_item_id,status,confidence")
          .in("line_item_id", lineIds)
      : { data: [], error: null };
    if (matchRows.error) throw matchRows.error;
    const matches = (matchRows.data ?? []) as MatchRow[];
    const catalogIds = [...new Set(matches.flatMap(({ catalog_item_id }) =>
      catalog_item_id ? [catalog_item_id] : []
    ))];
    const catalogRows = catalogIds.length
      ? await this.database.from("catalog_items").select("id,name").in("id", catalogIds)
      : { data: [], error: null };
    if (catalogRows.error) throw catalogRows.error;
    const catalogNames = new Map(
      ((catalogRows.data ?? []) as CatalogNameRow[]).map(({ id, name }) => [id, name])
    );
    const matchByLine = new Map(matches.map((match) => [match.line_item_id, match]));

    const lineItems: UploadedQuoteLineItem[] = lines.map((line) => {
      const match = matchByLine.get(line.id);
      return {
        id: line.id,
        sourceRow: line.source_row,
        description: line.description_raw,
        quantity: Number(line.quantity_raw),
        unit: line.unit_raw,
        unitRate: Number(line.unit_rate_raw),
        lineTotal: Number(line.line_total_raw),
        match: {
          catalogItemId: match?.catalog_item_id ?? null,
          catalogItemName: match?.catalog_item_id
            ? catalogNames.get(match.catalog_item_id) ?? null
            : null,
          status: match?.status ?? "unmatched",
          confidence: match?.confidence === null || match?.confidence === undefined
            ? null
            : Number(match.confidence)
        }
      };
    });

    return {
      idempotent: input.idempotent,
      sha256: input.sha256,
      filename: input.filename,
      supplier: { id: storedSupplier.id, name: storedSupplier.display_name },
      quote: {
        id: storedQuote.id,
        quoteNumber: input.document.quote.quoteNumber,
        quoteDate: storedQuote.quote_date,
        currency: storedQuote.currency,
        total: storedQuote.total_raw === null ? null : Number(storedQuote.total_raw)
      },
      lineItems,
      warnings: input.warnings
    };
  }
}
