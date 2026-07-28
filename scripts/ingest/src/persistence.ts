import { createServiceDatabaseClient } from "@quote-intelligence/database";
import {
  extractedDocumentSchema,
  normalizeToExVat,
  nearlyEqual,
  type ExtractedDocument
} from "@quote-intelligence/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

interface PersistDocumentInput {
  ingestionRunId: string;
  filename: string;
  fileType: "pdf" | "xlsx";
  sha256: string;
  document: ExtractedDocument;
  normalizedDate: string;
  warnings: string[];
}

interface RecordWithId {
  id: string;
}

interface StoredExtraction {
  raw_extraction: unknown;
  extraction_warnings: unknown;
}

export class IngestionRepository {
  private readonly database: SupabaseClient;

  constructor(database = createServiceDatabaseClient()) {
    this.database = database;
  }

  async startRun(documentCount: number): Promise<string> {
    const { data, error } = await this.database
      .from("ingestion_runs")
      .insert({
        parser_version: "0.1.0",
        matching_version: "0.1.0",
        document_count: documentCount
      })
      .select("id")
      .single<RecordWithId>();
    if (error) throw error;
    return data.id;
  }

  async finishRun(runId: string, errorCount: number): Promise<void> {
    const { error } = await this.database
      .from("ingestion_runs")
      .update({
        completed_at: new Date().toISOString(),
        error_count: errorCount,
        status: errorCount > 0 ? "completed_with_errors" : "completed"
      })
      .eq("id", runId);
    if (error) throw error;
  }

  async failRun(runId: string): Promise<void> {
    const { error } = await this.database
      .from("ingestion_runs")
      .update({ completed_at: new Date().toISOString(), status: "failed" })
      .eq("id", runId);
    if (error) throw error;
  }

  async findParsedDocument(
    sha256: string
  ): Promise<{ document: ExtractedDocument; warnings: string[] } | null> {
    const { data, error } = await this.database
      .from("source_documents")
      .select("raw_extraction, extraction_warnings")
      .eq("sha256", sha256)
      .eq("extraction_status", "parsed")
      .maybeSingle<StoredExtraction>();
    if (error) throw error;
    if (!data?.raw_extraction) return null;

    const parsed = extractedDocumentSchema.safeParse(data.raw_extraction);
    if (!parsed.success) return null;
    const warnings = Array.isArray(data.extraction_warnings)
      ? data.extraction_warnings.filter(
          (warning): warning is string => typeof warning === "string"
        )
      : [];
    return { document: parsed.data, warnings };
  }

  async persistDocument(input: PersistDocumentInput): Promise<void> {
    const sourceDocumentId = await this.upsertSourceDocument(input);
    const supplierId = await this.upsertSupplier(input.document);
    const quoteId = await this.upsertQuote(input, sourceDocumentId, supplierId);
    await this.replaceLineItems(quoteId, input.document);
  }

  private async upsertSourceDocument(input: PersistDocumentInput): Promise<string> {
    const { data, error } = await this.database
      .from("source_documents")
      .upsert(
        {
          ingestion_run_id: input.ingestionRunId,
          filename: input.filename,
          file_type: input.fileType,
          sha256: input.sha256,
          extraction_status: "parsed",
          raw_extraction: input.document,
          extraction_warnings: input.warnings
        },
        { onConflict: "sha256" }
      )
      .select("id")
      .single<RecordWithId>();
    if (error) throw error;
    return data.id;
  }

  private async upsertSupplier(document: ExtractedDocument): Promise<string> {
    const supplier = document.supplier;
    const canonicalName = supplier.name
      .toLowerCase()
      .replace(/\b\(pty\)|\bltd\b|\bcc\b|[^\p{L}\p{N}]+/gu, " ")
      .trim();

    if (supplier.vatNumber) {
      const { data, error } = await this.database
        .from("suppliers")
        .upsert(
          {
            canonical_name: canonicalName,
            display_name: supplier.name,
            vat_number: supplier.vatNumber,
            email: supplier.email ?? null,
            phone: supplier.phone ?? null,
            address: supplier.address ?? null
          },
          { onConflict: "vat_number" }
        )
        .select("id")
        .single<RecordWithId>();
      if (error) throw error;
      return data.id;
    }

    const { data: existing, error: selectError } = await this.database
      .from("suppliers")
      .select("id")
      .eq("canonical_name", canonicalName)
      .maybeSingle<RecordWithId>();
    if (selectError) throw selectError;
    if (existing) return existing.id;

    const { data, error } = await this.database
      .from("suppliers")
      .insert({ canonical_name: canonicalName, display_name: supplier.name })
      .select("id")
      .single<RecordWithId>();
    if (error) throw error;
    return data.id;
  }

  private async upsertQuote(
    input: PersistDocumentInput,
    sourceDocumentId: string,
    supplierId: string
  ): Promise<string> {
    const { quote } = input.document;
    const revision = quote.revisionNumber ?? inferRevision(quote.quoteNumber);
    const baseQuoteNumber = quote.quoteNumber.replace(/\s*\(rev(?:ision)?\s*\d+\)\s*$/i, "");
    const validationStatus = input.warnings.length > 0 ? "warning" : "valid";

    const { data, error } = await this.database
      .from("quotes")
      .upsert(
        {
          source_document_id: sourceDocumentId,
          supplier_id: supplierId,
          quote_number: baseQuoteNumber,
          revision_number: revision,
          is_current_revision: false,
          quote_date: input.normalizedDate,
          event_name: quote.eventName ?? null,
          currency: quote.currency,
          vat_rate: quote.vatRate,
          tax_basis: quote.taxBasis,
          subtotal_raw: quote.subtotal ?? null,
          vat_amount_raw: quote.vatAmount ?? null,
          total_raw: quote.total ?? null,
          validation_status: validationStatus,
          validation_warnings: input.warnings
        },
        { onConflict: "source_document_id" }
      )
      .select("id")
      .single<RecordWithId>();
    if (error) throw error;

    await this.reconcileRevisions(supplierId, baseQuoteNumber);
    return data.id;
  }

  private async reconcileRevisions(supplierId: string, quoteNumber: string): Promise<void> {
    const { data, error } = await this.database
      .from("quotes")
      .select("id, revision_number")
      .eq("supplier_id", supplierId)
      .eq("quote_number", quoteNumber)
      .order("revision_number", { ascending: false });
    if (error) throw error;
    const revisions = (data ?? []) as Array<{ id: string; revision_number: number }>;
    const current = revisions[0];
    if (!current) return;

    const { error: clearError } = await this.database
      .from("quotes")
      .update({ is_current_revision: false })
      .eq("supplier_id", supplierId)
      .eq("quote_number", quoteNumber);
    if (clearError) throw clearError;

    const previous = revisions[1];
    const { error: currentError } = await this.database
      .from("quotes")
      .update({
        is_current_revision: true,
        supersedes_quote_id: previous?.id ?? null
      })
      .eq("id", current.id);
    if (currentError) throw currentError;
  }

  private async replaceLineItems(
    quoteId: string,
    document: ExtractedDocument
  ): Promise<void> {
    const { error: deleteError } = await this.database
      .from("quote_line_items")
      .delete()
      .eq("quote_id", quoteId);
    if (deleteError) throw deleteError;

    const rows = document.lineItems.map((item) => {
      const unitRate = normalizeToExVat(
        item.unitRate,
        document.quote.taxBasis,
        document.quote.vatRate
      );
      const lineTotal = normalizeToExVat(
        item.lineTotal,
        document.quote.taxBasis,
        document.quote.vatRate
      );
      return {
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
        normalization_status:
          unitRate.amountExVat === null ? "not_comparable" : "normalized",
        normalization_warnings:
          unitRate.amountExVat === null ? [unitRate.reason] : []
      };
    });

    const { error } = await this.database.from("quote_line_items").insert(rows);
    if (error) throw error;
  }
}

function inferRevision(quoteNumber: string): number {
  const match = quoteNumber.match(/\(rev(?:ision)?\s*(\d+)\)/i);
  return match?.[1] ? Number(match[1]) : 0;
}
