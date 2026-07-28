import {
  extractedDocumentSchema,
  type ExtractedDocument
} from "@quote-intelligence/domain";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export const DOCUPIPE_EXTRACTION_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  description:
    "Structured supplier quotation metadata and priced line items for procurement analysis.",
  type: "object",
  properties: {
    supplier: {
      type: "object",
      description: "The business that issued the quotation.",
      properties: {
        name: { type: "string", description: "Supplier trading or legal name." },
        vatNumber: { type: "string", description: "Supplier VAT registration number." },
        contactName: { type: "string", description: "Supplier contact person's name." },
        email: { type: "string", description: "Supplier contact email address." },
        phone: { type: "string", description: "Supplier contact telephone number." },
        address: { type: "string", description: "Supplier postal or physical address." }
      }
    },
    quote: {
      type: "object",
      description: "Quotation header, date, currency, and totals.",
      properties: {
        quoteNumber: { type: "string", description: "Quote, estimate, or reference number." },
        revisionNumber: { type: "integer", description: "Explicit numeric quote revision." },
        dateText: {
          type: "string",
          description: "Preserve the date exactly as written in the source."
        },
        eventName: { type: "string", description: "Event, project, or client reference." },
        currency: { type: "string", description: "Use ZAR unless explicitly stated otherwise." },
        vatRate: { type: "number", description: "Use 0.15 for 15%." },
        taxBasis: {
          type: "string",
          description: "Whether displayed prices include or exclude VAT.",
          enum: ["inclusive", "exclusive", "unknown"]
        },
        subtotal: { type: "number", description: "Subtotal before VAT." },
        vatAmount: { type: "number", description: "VAT amount charged." },
        total: { type: "number", description: "Final quotation total including VAT where applicable." }
      }
    },
    lineItems: {
      type: "array",
      description: "Every priced product or service row in source order.",
      items: {
        type: "object",
        description: "One priced quotation line.",
        properties: {
          sourceRow: { type: "string", description: "Original row or item identifier." },
          description: { type: "string", description: "Item description exactly as written." },
          quantity: { type: "number", description: "Quoted quantity." },
          unit: { type: "string", description: "Quoted pricing unit or basis." },
          unitRate: { type: "number", description: "Price for one quoted unit." },
          lineTotal: { type: "number", description: "Extended total for this line." }
        }
      }
    },
    notes: {
      type: "array",
      description: "Material assumptions or qualifications printed on the quotation.",
      items: { type: "string", description: "One source note." }
    }
  }
} as const;

interface DocuPipeClientOptions {
  apiKey: string;
  parseEndpoint: string;
  schemaId?: string;
}

interface JsonRecord {
  [key: string]: unknown;
}

export class DocuPipeClient {
  private readonly baseUrl: string;
  private schemaIdPromise: Promise<string> | null = null;

  constructor(private readonly options: DocuPipeClientOptions) {
    const configured = new URL(options.parseEndpoint);
    this.baseUrl =
      configured.hostname === "api.docupipe.ai"
        ? "https://app.docupipe.ai"
        : configured.origin;
  }

  async parsePdf(filePath: string): Promise<ExtractedDocument> {
    const schemaId = await this.getOrCreateSchemaId();
    const upload = await this.request("/document", {
      method: "POST",
      body: JSON.stringify({
        document: {
          file: {
            contents: (await readFile(filePath)).toString("base64"),
            filename: basename(filePath)
          }
        },
        dataset: "quote-intelligence-mvp",
        parseVersion: 3
      })
    });
    const documentId = requiredString(upload, ["documentId", "document_id"]);
    const parseJobId = requiredString(upload, ["jobId", "job_id"]);
    await this.waitForJob(parseJobId, `parsing ${basename(filePath)}`);

    const standardization = await this.request("/v3/standardize", {
      method: "POST",
      body: JSON.stringify({
        documentId,
        schemaId,
        stdVersion: 3,
        effortLevel: "standard",
        guidelines:
          "Extract values exactly from the quotation. South African dates are day-first. " +
          "Use ZAR and 15% VAT unless the document explicitly states otherwise. " +
          "Do not infer missing monetary amounts."
      })
    });
    const standardizationId = requiredString(standardization, [
      "standardizationId",
      "standardization_id",
      "id"
    ]);
    const standardizationJobId = optionalString(standardization, ["jobId", "job_id"]);
    if (standardizationJobId) {
      await this.waitForJob(standardizationJobId, `standardizing ${basename(filePath)}`);
    }

    const result = await this.request(`/standardization/${encodeURIComponent(standardizationId)}`);
    return extractedDocumentSchema.parse(removeNulls(unwrapStructuredResult(result)));
  }

  private async getOrCreateSchemaId(): Promise<string> {
    if (this.options.schemaId) return this.options.schemaId;
    this.schemaIdPromise ??= this.findOrCreateSchema();
    return this.schemaIdPromise;
  }

  private async findOrCreateSchema(): Promise<string> {
    const existing = await this.request("/schemas?limit=1000&exclude_payload=true");
    const schemas = collection(existing, ["schemas", "items", "data"]);
    const match = schemas.find((schema) => {
      const name = optionalString(schema, ["schemaName", "name"]);
      return name === "Quote Intelligence MVP v1";
    });
    if (match) return requiredString(match, ["schemaId", "id"]);

    const created = await this.request("/schema", {
      method: "POST",
      body: JSON.stringify({
        schemaName: "Quote Intelligence MVP v1",
        jsonSchema: DOCUPIPE_EXTRACTION_SCHEMA,
        guidelines:
          "Extract supplier identity, quote metadata, and every priced line item. " +
          "Preserve descriptions and units as written. Interpret South African numeric dates as day-first. " +
          "Classify taxBasis as inclusive, exclusive, or unknown from explicit document evidence."
      })
    });
    return requiredString(created, ["schemaId", "id"]);
  }

  private async waitForJob(jobId: string, label: string): Promise<void> {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const job = await this.request(`/job/${encodeURIComponent(jobId)}`);
      const status = optionalString(job, ["status"])?.toLowerCase();
      if (status === "completed") return;
      if (status === "error" || status === "failed") {
        throw new Error(`DocuPipe job failed while ${label}: ${JSON.stringify(job).slice(0, 800)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(`DocuPipe timed out while ${label}.`);
  }

  private async request(path: string, init: RequestInit = {}): Promise<JsonRecord> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-API-Key": this.options.apiKey,
          ...init.headers
        }
      });
    } catch (error) {
      throw new Error(
        `DocuPipe network request failed for ${this.baseUrl}${path}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`DocuPipe request failed (${response.status}) at ${path}: ${text.slice(0, 800)}`);
    }
    const payload: unknown = text ? JSON.parse(text) : {};
    if (Array.isArray(payload)) {
      return { items: payload };
    }
    if (!payload || typeof payload !== "object") {
      throw new Error(`Unexpected DocuPipe response at ${path}.`);
    }
    return payload as JsonRecord;
  }
}

function optionalString(record: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function requiredString(record: JsonRecord, keys: string[]): string {
  const value = optionalString(record, keys);
  if (!value) {
    throw new Error(`DocuPipe response is missing ${keys.join("/")}: ${JSON.stringify(record).slice(0, 800)}`);
  }
  return value;
}

function collection(record: JsonRecord, keys: string[]): JsonRecord[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)
      );
    }
  }
  return [];
}

function unwrapStructuredResult(payload: JsonRecord): unknown {
  const data = payload.data;
  if (data && typeof data === "object") return data;
  const result = payload.result;
  if (result && typeof result === "object") return result;
  const extraction = payload.extraction;
  if (extraction && typeof extraction === "object") return extraction;
  return payload;
}

function removeNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null).map(removeNulls);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null)
        .map(([key, item]) => [key, removeNulls(item)])
    );
  }
  return value;
}
