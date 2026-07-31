import {
  extractedDocumentSchema,
  type ExtractedDocument
} from "@quote-intelligence/domain";
import { Buffer } from "node:buffer";

const extractionSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  description: "Structured supplier quotation metadata and priced line items for procurement analysis.",
  type: "object",
  properties: {
    supplier: {
      type: "object",
      properties: {
        name: { type: "string" }, vatNumber: { type: "string" },
        contactName: { type: "string" }, email: { type: "string" },
        phone: { type: "string" }, address: { type: "string" }
      }
    },
    quote: {
      type: "object",
      properties: {
        quoteNumber: { type: "string" }, revisionNumber: { type: "integer" },
        dateText: { type: "string" }, eventName: { type: "string" },
        currency: { type: "string" }, vatRate: { type: "number" },
        taxBasis: { type: "string", enum: ["inclusive", "exclusive", "unknown"] },
        subtotal: { type: "number" }, vatAmount: { type: "number" }, total: { type: "number" }
      }
    },
    lineItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceRow: { type: "string" }, description: { type: "string" },
          quantity: { type: "number" }, unit: { type: "string" },
          unitRate: { type: "number" }, lineTotal: { type: "number" }
        }
      }
    },
    notes: { type: "array", items: { type: "string" } }
  }
} as const;

interface ClientOptions {
  apiKey: string;
  parseEndpoint: string;
  schemaId?: string;
}

type JsonRecord = Record<string, unknown>;

export class DocuPipeBufferClient {
  private readonly baseUrl: string;
  private schemaIdPromise: Promise<string> | null = null;

  constructor(private readonly options: ClientOptions) {
    const configured = new URL(options.parseEndpoint);
    this.baseUrl = configured.hostname === "api.docupipe.ai"
      ? "https://app.docupipe.ai"
      : configured.origin;
  }

  async parsePdf(contents: Uint8Array, filename: string): Promise<ExtractedDocument> {
    const schemaId = await this.getOrCreateSchemaId();
    const upload = await this.request("/document", {
      method: "POST",
      body: JSON.stringify({
        document: {
          file: {
            contents: Buffer.from(contents).toString("base64"),
            filename
          }
        },
        dataset: "quote-intelligence-upload",
        parseVersion: 3
      })
    });
    const documentId = requiredString(upload, ["documentId", "document_id"]);
    const parseJobId = requiredString(upload, ["jobId", "job_id"]);
    await this.waitForJob(parseJobId, `parsing ${filename}`);

    const standardization = await this.request("/v3/standardize", {
      method: "POST",
      body: JSON.stringify({
        documentId,
        schemaId,
        stdVersion: 3,
        effortLevel: "standard",
        guidelines:
          "Extract values exactly from the quotation. South African dates are day-first. " +
          "Use ZAR and 15% VAT unless explicitly stated otherwise. Do not infer missing monetary amounts."
      })
    });
    const standardizationId = requiredString(standardization, [
      "standardizationId", "standardization_id", "id"
    ]);
    const jobId = optionalString(standardization, ["jobId", "job_id"]);
    if (jobId) await this.waitForJob(jobId, `standardizing ${filename}`);

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
    const match = collection(existing, ["schemas", "items", "data"]).find(
      (schema) => optionalString(schema, ["schemaName", "name"]) === "Quote Intelligence MVP v1"
    );
    if (match) return requiredString(match, ["schemaId", "id"]);

    const created = await this.request("/schema", {
      method: "POST",
      body: JSON.stringify({
        schemaName: "Quote Intelligence MVP v1",
        jsonSchema: extractionSchema,
        guidelines:
          "Extract supplier identity, quote metadata, and every priced line item. " +
          "Preserve source descriptions and units. Interpret South African numeric dates as day-first."
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
        throw new Error(`DocuPipe job failed while ${label}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(`DocuPipe timed out while ${label}.`);
  }

  private async request(path: string, init: RequestInit = {}): Promise<JsonRecord> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-Key": this.options.apiKey,
        ...init.headers
      }
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`DocuPipe request failed (${response.status}) at ${path}: ${responseText.slice(0, 500)}`);
    }
    const payload: unknown = responseText ? JSON.parse(responseText) : {};
    if (Array.isArray(payload)) return { items: payload };
    if (!payload || typeof payload !== "object") throw new Error(`Unexpected DocuPipe response at ${path}.`);
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
  if (!value) throw new Error(`DocuPipe response is missing ${keys.join("/")}.`);
  return value;
}

function collection(record: JsonRecord, keys: string[]): JsonRecord[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is JsonRecord =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
      );
    }
  }
  return [];
}

function unwrapStructuredResult(payload: JsonRecord): unknown {
  for (const key of ["data", "result", "extraction"]) {
    const value = payload[key];
    if (value && typeof value === "object") return value;
  }
  return payload;
}

function removeNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((item) => item !== null).map(removeNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null)
        .map(([key, item]) => [key, removeNulls(item)])
    );
  }
  return value;
}
