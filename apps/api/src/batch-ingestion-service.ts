import {
  CATALOG_CATEGORIES,
  normalizeCatalogRate,
  normalizeToExVat,
  validateExtractedDocument,
  type BatchQuoteUploadInput,
  type BatchQuoteUploadResult,
  type CatalogNormalizationLine,
  type ExtractedDocument
} from "@quote-intelligence/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { DocuPipeBufferClient } from "./docupipe-buffer-client";
import {
  OpenAICatalogNormalizer,
  type CatalogNormalizer,
  type NormalizationCatalogContext
} from "./openai-normalizer";
import { parseXlsxQuoteBuffer } from "./xlsx-buffer-parser";
import { parseSouthAfricanDate } from "./quote-date";

interface RecordWithId {
  id: string;
}

interface PersistedLine {
  id: string;
  source_row: string | null;
  unit_raw: string;
  unit_rate_ex_vat: number | string | null;
  description_raw: string;
  quantity_raw: number | string;
}

interface BatchIngestionOptions {
  normalizer?: CatalogNormalizer;
  docuPipe?: Pick<DocuPipeBufferClient, "parsePdf">;
}

export class BatchIngestionService {
  private readonly normalizer: CatalogNormalizer;
  private readonly docuPipe: Pick<DocuPipeBufferClient, "parsePdf">;

  constructor(
    private readonly database: SupabaseClient,
    private readonly userId: string,
    options: BatchIngestionOptions = {}
  ) {
    this.normalizer = options.normalizer ?? new OpenAICatalogNormalizer();
    this.docuPipe =
      options.docuPipe ??
      new DocuPipeBufferClient({
        apiKey: process.env.DOCUPIPE_API_KEY ?? "",
        parseEndpoint:
          process.env.DOCUPIPE_PARSE_ENDPOINT ??
          "https://api.docupipe.ai/v1/parse",
        ...(process.env.DOCUPIPE_SCHEMA_ID
          ? { schemaId: process.env.DOCUPIPE_SCHEMA_ID }
          : {})
      });
  }

  async ingest(input: BatchQuoteUploadInput): Promise<BatchQuoteUploadResult> {
    const model = process.env.OPENAI_NORMALIZATION_MODEL ?? "gpt-4o-mini";
    const { data: run, error: runError } = await this.database
      .from("ingestion_runs")
      .insert({
        user_id: this.userId,
        parser_version: "tenant-upload-v1",
        matching_version: "openai-structured-v1",
        normalization_model: model,
        document_count: input.files.length
      })
      .select("id")
      .single<RecordWithId>();
    if (runError) throw runError;

    const results: BatchQuoteUploadResult["documents"] = [];
    for (const file of input.files) {
      try {
        const warnings = await this.processFile(run.id, file);
        results.push({
          filename: file.filename,
          status: "parsed",
          warningCount: warnings.length,
          error: null
        });
      } catch (error) {
        results.push({
          filename: file.filename,
          status: "failed",
          warningCount: 0,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const errorCount = results.filter(({ status }) => status === "failed").length;
    const { error: finishError } = await this.database
      .from("ingestion_runs")
      .update({
        completed_at: new Date().toISOString(),
        error_count: errorCount,
        status: errorCount > 0 ? "completed_with_errors" : "completed"
      })
      .eq("id", run.id);
    if (finishError) throw finishError;

    return { runId: run.id, accepted: input.files.length, documents: results };
  }

  private async processFile(
    runId: string,
    file: BatchQuoteUploadInput["files"][number]
  ): Promise<string[]> {
    const bytes = Buffer.from(file.contentBase64, "base64");
    if (bytes.length === 0) throw new Error("The uploaded file is empty.");
    if (bytes.length > 25 * 1024 * 1024) {
      throw new Error("Files must be 25 MB or smaller.");
    }
    const expectedExtension =
      file.mimeType === "application/pdf" ? /\.pdf$/i : /\.xlsx$/i;
    if (!expectedExtension.test(file.filename)) {
      throw new Error("The filename extension does not match the selected file type.");
    }
    if (file.mimeType === "application/pdf" && bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("The uploaded file is not a valid PDF document.");
    }
    if (
      file.mimeType.endsWith("spreadsheetml.sheet") &&
      !(bytes[0] === 0x50 && bytes[1] === 0x4b)
    ) {
      throw new Error("The uploaded file is not a valid XLSX workbook.");
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { data: duplicate, error: duplicateError } = await this.database
      .from("source_documents")
      .select("id,storage_path")
      .eq("user_id", this.userId)
      .eq("sha256", sha256)
      .maybeSingle<RecordWithId & { storage_path: string | null }>();
    if (duplicateError) throw duplicateError;
    if (duplicate) {
      if (!duplicate.storage_path) {
        const legacyStoragePath = `${this.userId}/${runId}/${safeFilename(file.filename)}`;
        const { error: legacyStorageError } = await this.database.storage
          .from("quote-source-files")
          .upload(legacyStoragePath, bytes, {
            contentType: file.mimeType,
            upsert: false
          });
        if (legacyStorageError) throw legacyStorageError;
        const { error: legacySourceError } = await this.database
          .from("source_documents")
          .update({ storage_path: legacyStoragePath })
          .eq("id", duplicate.id);
        if (legacySourceError) {
          await this.database.storage
            .from("quote-source-files")
            .remove([legacyStoragePath]);
          throw legacySourceError;
        }
        return [
          "Duplicate extraction retained; the original file was added to the private vault."
        ];
      }
      return ["Duplicate document skipped; the existing source was retained."];
    }

    const storagePath = `${this.userId}/${runId}/${safeFilename(file.filename)}`;
    const { error: storageError } = await this.database.storage
      .from("quote-source-files")
      .upload(storagePath, bytes, {
        contentType: file.mimeType,
        upsert: false
      });
    if (storageError) throw storageError;

    const fileType = file.mimeType === "application/pdf" ? "pdf" : "xlsx";
    const { data: source, error: sourceError } = await this.database
      .from("source_documents")
      .insert({
        user_id: this.userId,
        ingestion_run_id: runId,
        filename: file.filename,
        file_type: fileType,
        sha256,
        storage_path: storagePath,
        extraction_status: "processing"
      })
      .select("id")
      .single<RecordWithId>();
    if (sourceError) {
      await this.database.storage.from("quote-source-files").remove([storagePath]);
      throw sourceError;
    }

    try {
      if (fileType === "pdf" && !process.env.DOCUPIPE_API_KEY) {
        throw new Error("DOCUPIPE_API_KEY is required for PDF parsing.");
      }
      const document =
        fileType === "pdf"
          ? await this.docuPipe.parsePdf(bytes, file.filename)
          : parseXlsxQuoteBuffer(bytes);
      const warnings = validateExtractedDocument(document).map(
        ({ message }) => message
      );
      const normalizedDate = parseSouthAfricanDate(document.quote.dateText);
      const { error: extractionError } = await this.database
        .from("source_documents")
        .update({
          extraction_status: "parsed",
          raw_extraction: document,
          extraction_warnings: warnings
        })
        .eq("id", source.id);
      if (extractionError) throw extractionError;

      const supplierId = await this.persistSupplier(document);
      const quoteId = await this.persistQuote(
        source.id,
        supplierId,
        normalizedDate,
        document,
        warnings
      );
      const lines = await this.persistRawLines(quoteId, document);
      try {
        await this.normalizeLines(lines);
      } catch (normalizationError) {
        const warning = `Catalog normalization pending: ${
          normalizationError instanceof Error
            ? normalizationError.message
            : String(normalizationError)
        }`;
        warnings.push(warning);
        const { error: warningError } = await this.database
          .from("source_documents")
          .update({ extraction_warnings: warnings })
          .eq("id", source.id);
        if (warningError) throw warningError;
      }
      return warnings;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.database
        .from("source_documents")
        .update({ extraction_status: "failed", extraction_warnings: [message] })
        .eq("id", source.id);
      throw error;
    }
  }

  private async persistSupplier(document: ExtractedDocument): Promise<string> {
    const supplier = document.supplier;
    const canonicalName = supplier.name
      .toLowerCase()
      .replace(/\b\(pty\)|\bltd\b|\bcc\b|[^\p{L}\p{N}]+/gu, " ")
      .trim();
    let query = this.database
      .from("suppliers")
      .select("id")
      .eq("user_id", this.userId);
    query = supplier.vatNumber
      ? query.eq("vat_number", supplier.vatNumber)
      : query.eq("canonical_name", canonicalName);
    const { data: existing, error: existingError } =
      await query.maybeSingle<RecordWithId>();
    if (existingError) throw existingError;
    if (existing) {
      const { error } = await this.database
        .from("suppliers")
        .update({
          display_name: supplier.name,
          email: supplier.email ?? null,
          phone: supplier.phone ?? null,
          address: supplier.address ?? null
        })
        .eq("id", existing.id);
      if (error) throw error;
      return existing.id;
    }

    const { data, error } = await this.database
      .from("suppliers")
      .insert({
        user_id: this.userId,
        canonical_name: canonicalName,
        display_name: supplier.name,
        vat_number: supplier.vatNumber ?? null,
        email: supplier.email ?? null,
        phone: supplier.phone ?? null,
        address: supplier.address ?? null
      })
      .select("id")
      .single<RecordWithId>();
    if (error) throw error;
    return data.id;
  }

  private async persistQuote(
    sourceDocumentId: string,
    supplierId: string,
    quoteDate: string,
    document: ExtractedDocument,
    warnings: string[]
  ): Promise<string> {
    const revision = document.quote.revisionNumber ?? 0;
    const quoteNumber = document.quote.quoteNumber.replace(
      /\s*\(rev(?:ision)?\s*\d+\)\s*$/i,
      ""
    );
    const { data, error } = await this.database
      .from("quotes")
      .insert({
        user_id: this.userId,
        source_document_id: sourceDocumentId,
        supplier_id: supplierId,
        quote_number: quoteNumber,
        revision_number: revision,
        is_current_revision: false,
        quote_date: quoteDate,
        event_name: document.quote.eventName ?? null,
        currency: document.quote.currency,
        vat_rate: document.quote.vatRate,
        tax_basis: document.quote.taxBasis,
        subtotal_raw: document.quote.subtotal ?? null,
        vat_amount_raw: document.quote.vatAmount ?? null,
        total_raw: document.quote.total ?? null,
        validation_status: warnings.length ? "warning" : "valid",
        validation_warnings: warnings
      })
      .select("id")
      .single<RecordWithId>();
    if (error) throw error;

    const { data: revisions, error: revisionError } = await this.database
      .from("quotes")
      .select("id,revision_number")
      .eq("supplier_id", supplierId)
      .eq("quote_number", quoteNumber)
      .order("revision_number", { ascending: false });
    if (revisionError) throw revisionError;
    const revisionRows = (revisions ?? []) as Array<{
      id: string;
      revision_number: number;
    }>;
    await this.database
      .from("quotes")
      .update({ is_current_revision: false })
      .eq("supplier_id", supplierId)
      .eq("quote_number", quoteNumber);
    const current = revisionRows[0];
    if (current) {
      const { error: currentError } = await this.database
        .from("quotes")
        .update({
          is_current_revision: true,
          supersedes_quote_id: revisionRows[1]?.id ?? null
        })
        .eq("id", current.id);
      if (currentError) throw currentError;
    }
    return data.id;
  }

  private async persistRawLines(
    quoteId: string,
    document: ExtractedDocument
  ): Promise<PersistedLine[]> {
    const rows = document.lineItems.map((line) => {
      const rate = normalizeToExVat(
        line.unitRate,
        document.quote.taxBasis,
        document.quote.vatRate
      );
      const total = normalizeToExVat(
        line.lineTotal,
        document.quote.taxBasis,
        document.quote.vatRate
      );
      return {
        user_id: this.userId,
        quote_id: quoteId,
        source_row: line.sourceRow ?? null,
        description_raw: line.description,
        quantity_raw: line.quantity,
        unit_raw: line.unit,
        unit_rate_raw: line.unitRate,
        line_total_raw: line.lineTotal,
        currency: document.quote.currency,
        tax_basis: document.quote.taxBasis,
        unit_rate_ex_vat: rate.amountExVat,
        line_total_ex_vat: total.amountExVat,
        arithmetic_valid: Math.abs(line.quantity * line.unitRate - line.lineTotal) <= 0.02,
        normalization_status:
          rate.amountExVat === null ? "not_comparable" : "normalized",
        normalization_warnings: rate.amountExVat === null ? [rate.reason] : []
      };
    });
    const { data, error } = await this.database
      .from("quote_line_items")
      .insert(rows)
      .select(
        "id,source_row,unit_raw,unit_rate_ex_vat,description_raw,quantity_raw"
      );
    if (error) throw error;
    return (data ?? []) as PersistedLine[];
  }

  private async normalizeLines(lines: PersistedLine[]): Promise<void> {
    const context = await this.catalogContext();
    const response = await this.normalizer.normalize({
      userId: this.userId,
      catalog: context,
      lines: lines.map((line) => ({
        lineItemId: line.id,
        description: line.description_raw,
        unit: line.unit_raw,
        quantity: Number(line.quantity_raw)
      }))
    });
    const normalizedByLine = new Map(
      response.lines.map((line) => [line.lineItemId, line])
    );

    for (const line of lines) {
      const normalized = normalizedByLine.get(line.id);
      if (!normalized) {
        const { error } = await this.database.from("catalog_matches").insert({
          user_id: this.userId,
          line_item_id: line.id,
          catalog_item_id: null,
          status: "unmatched",
          method: null,
          confidence: null,
          reason_codes: ["LLM_RESULT_MISSING"]
        });
        if (error) throw error;
        continue;
      }
      const protectedConflict = protectedAttributeConflict(
        line.description_raw,
        normalized
      );
      if (protectedConflict) {
        const { error } = await this.database.from("catalog_matches").insert({
          user_id: this.userId,
          line_item_id: line.id,
          catalog_item_id: null,
          status: "unmatched",
          method: null,
          confidence: null,
          reason_codes: ["LLM_PROTECTED_ATTRIBUTE_CONFLICT"],
          normalization_metadata: { explanation: protectedConflict }
        });
        if (error) throw error;
        continue;
      }
      await this.persistNormalization(line, normalized, context);
    }
  }

  private async persistNormalization(
    line: PersistedLine,
    normalized: CatalogNormalizationLine,
    context: NormalizationCatalogContext[]
  ): Promise<void> {
    let catalogItemId =
      normalized.action === "match" &&
      normalized.catalogItemId &&
      context.some(({ id }) => id === normalized.catalogItemId)
        ? normalized.catalogItemId
        : null;
    catalogItemId ??=
      context.find(
        ({ name }) => name.toLocaleLowerCase() === normalized.baseName.toLocaleLowerCase()
      )?.id ?? null;
    if (!catalogItemId) {
      const { data: existing, error: existingError } = await this.database
        .from("catalog_items")
        .select("id")
        .eq("user_id", this.userId)
        .ilike("name", normalized.baseName)
        .maybeSingle<RecordWithId>();
      if (existingError) throw existingError;
      if (existing) catalogItemId = existing.id;
      else {
        const { data: created, error } = await this.database
          .from("catalog_items")
          .insert({
            user_id: this.userId,
            name: normalized.baseName,
            category: canonicalCategory(normalized.category),
            description: `${normalized.baseName}, consolidated from supplier descriptions.`,
            canonical_unit: normalized.canonicalUnit,
            canonical_pricing_basis: normalized.pricingBasis,
            attributes: { generatedBy: "openai-structured-v1" },
            is_base_profile: true
          })
          .select("id")
          .single<RecordWithId>();
        if (error) throw error;
        catalogItemId = created.id;
      }
    }

    const { data: existingVariant, error: variantLookupError } = await this.database
      .from("catalog_item_variants")
      .select("id")
      .eq("catalog_item_id", catalogItemId)
      .ilike("label", normalized.variantLabel)
      .maybeSingle<RecordWithId>();
    if (variantLookupError) throw variantLookupError;
    let variantId = existingVariant?.id;
    if (!variantId) {
      const { data: variant, error } = await this.database
        .from("catalog_item_variants")
        .insert({
          user_id: this.userId,
          catalog_item_id: catalogItemId,
          label: normalized.variantLabel,
          attributes: normalized.variantAttributes,
          canonical_unit: normalized.canonicalUnit,
          canonical_pricing_basis: normalized.pricingBasis
        })
        .select("id")
        .single<RecordWithId>();
      if (error) throw error;
      variantId = variant.id;
    }

    const status = normalized.confidence >= 0.75 ? "matched" : "review";
    const model = process.env.OPENAI_NORMALIZATION_MODEL ?? "gpt-4o-mini";
    const { error: matchError } = await this.database
      .from("catalog_matches")
      .insert({
        user_id: this.userId,
        line_item_id: line.id,
        catalog_item_id: catalogItemId,
        variant_id: variantId,
        status,
        method: "llm",
        confidence: normalized.confidence,
        model_version: model,
        reason_codes: ["OPENAI_STRUCTURED_NORMALIZATION"],
        normalization_metadata: {
          rationale: normalized.rationale,
          variantAttributes: normalized.variantAttributes
        }
      });
    if (matchError) throw matchError;

    const rate = normalizeCatalogRate(
      line.unit_rate_ex_vat === null ? null : Number(line.unit_rate_ex_vat),
      line.unit_raw,
      normalized.pricingBasis
    );
    const { error: normalizationError } = await this.database
      .from("price_normalizations")
      .insert({
        user_id: this.userId,
        line_item_id: line.id,
        variant_id: variantId,
        canonical_rate_ex_vat: rate.canonicalRate,
        canonical_basis: rate.canonicalBasis,
        estimated: rate.estimated,
        comparable: rate.comparable,
        explanation: rate.explanation
      });
    if (normalizationError) throw normalizationError;
  }

  private async catalogContext(): Promise<NormalizationCatalogContext[]> {
    const { data: items, error: itemError } = await this.database
      .from("catalog_items")
      .select("id,name,category,canonical_unit,canonical_pricing_basis")
      .eq("active", true)
      .order("name");
    if (itemError) throw itemError;
    const itemRows = (items ?? []) as Array<{
      id: string;
      name: string;
      category: string;
      canonical_unit: string;
      canonical_pricing_basis: string;
    }>;
    const itemIds = itemRows.map(({ id }) => id);
    const { data: variants, error: variantError } = itemIds.length
      ? await this.database
          .from("catalog_item_variants")
          .select("id,catalog_item_id,label,attributes")
          .in("catalog_item_id", itemIds)
          .eq("active", true)
      : { data: [], error: null };
    if (variantError) throw variantError;
    const variantRows = (variants ?? []) as Array<{
      id: string;
      catalog_item_id: string;
      label: string;
      attributes: Record<string, string> | null;
    }>;
    return itemRows.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      canonicalUnit: item.canonical_unit,
      pricingBasis: item.canonical_pricing_basis,
      variants: variantRows
        .filter(({ catalog_item_id }) => catalog_item_id === item.id)
        .map((variant) => ({
          id: variant.id,
          label: variant.label,
          attributes: variant.attributes ?? {}
        }))
    }));
  }
}

function safeFilename(filename: string): string {
  return (
    filename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "quote-upload"
  );
}

function canonicalCategory(value: string): (typeof CATALOG_CATEGORIES)[number] {
  return (
    CATALOG_CATEGORIES.find(
      (category) => category.toLocaleLowerCase() === value.trim().toLocaleLowerCase()
    ) ?? "Uncategorised"
  );
}

export function protectedAttributeConflict(
  description: string,
  normalized: CatalogNormalizationLine
): string | null {
  const source = description.toLocaleLowerCase();
  const target = [
    normalized.variantLabel,
    normalized.canonicalUnit,
    normalized.pricingBasis,
    ...Object.values(normalized.variantAttributes)
  ]
    .join(" ")
    .toLocaleLowerCase();
  const compactTarget = target.replace(/\s+/g, "");
  const required: Array<{ token: string; pattern: RegExp }> = [];

  for (const match of source.matchAll(/(\d+(?:\.\d+)?)\s*kva\b/g)) {
    required.push({ token: `${match[1]} kVA`, pattern: new RegExp(`${match[1]}\\s*kva`, "i") });
  }
  for (const match of source.matchAll(/(\d+(?:\.\d+)?)\s*m?\s*[x×]\s*(\d+(?:\.\d+)?)\s*m?\b/g)) {
    required.push({
      token: `${match[1]} × ${match[2]}`,
      pattern: new RegExp(`${match[1]}m?[x×]${match[2]}m?`, "i")
    });
  }
  for (const match of source.matchAll(/(\d+(?:\.\d+)?)\s*(?:-|\s)?(?:tonnes?|tons?|t)\b/g)) {
    required.push({
      token: `${match[1]} ton`,
      pattern: new RegExp(`${match[1]}(?:-)?(?:tonne|ton|t)`, "i")
    });
  }
  if (/\bnight(?:time)?\b/.test(source)) {
    required.push({ token: "night", pattern: /night/i });
  }
  if (/\bday(?:time)?\s+(?:shift|security)|\bday\s*shift\b/.test(source)) {
    required.push({ token: "day", pattern: /day/i });
  }

  const missing = required.find(({ pattern }) => !pattern.test(compactTarget));
  if (missing) return `Protected source attribute “${missing.token}” was absent from the normalized variant.`;
  if (/\b(?:per\s+)?(?:km|kilomet(?:er|re))\b/.test(source) && !/(?:km|kilomet)/.test(target)) {
    return "Per-kilometre pricing cannot be normalized to a non-distance basis.";
  }
  if (/\b(?:per\s+)?trip\b/.test(source) && !/trip/.test(target)) {
    return "Per-trip pricing cannot be normalized to a non-trip basis.";
  }
  if (/\b(?:per\s+hour|hourly)\b/.test(source) && !/hour/.test(target)) {
    return "Hourly pricing cannot be normalized to a non-hourly basis.";
  }
  if (/\b(?:per\s+day|daily)\b/.test(source) && !/day/.test(target)) {
    return "Daily pricing cannot be normalized to a non-daily basis.";
  }
  return null;
}
