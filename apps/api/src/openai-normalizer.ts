import {
  catalogNormalizationResponseSchema,
  type CatalogNormalizationResponse
} from "@quote-intelligence/domain";
import { createHash } from "node:crypto";

export interface NormalizationCatalogContext {
  id: string;
  name: string;
  category: string;
  canonicalUnit: string;
  pricingBasis: string;
  variants: Array<{
    id: string;
    label: string;
    attributes: Record<string, string>;
  }>;
}

export interface NormalizationSourceLine {
  lineItemId: string;
  description: string;
  unit: string;
  quantity: number;
}

export interface CatalogNormalizer {
  normalize(input: {
    userId: string;
    lines: NormalizationSourceLine[];
    catalog: NormalizationCatalogContext[];
    existingCategories: string[];
  }): Promise<CatalogNormalizationResponse>;
}

interface OpenAINormalizerOptions {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lines"],
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "lineItemId",
          "action",
          "catalogItemId",
          "baseName",
          "category",
          "variantLabel",
          "variantAttributes",
          "canonicalUnit",
          "pricingBasis",
          "confidence",
          "rationale"
        ],
        properties: {
          lineItemId: { type: "string" },
          action: { type: "string", enum: ["match", "create"] },
          catalogItemId: { anyOf: [{ type: "string" }, { type: "null" }] },
          baseName: { type: "string" },
          category: { type: "string" },
          variantLabel: { type: "string" },
          variantAttributes: {
            type: "object",
            additionalProperties: false,
            required: ["size", "capacity", "weightClass", "specification", "shift"],
            properties: {
              size: { anyOf: [{ type: "string" }, { type: "null" }] },
              capacity: { anyOf: [{ type: "string" }, { type: "null" }] },
              weightClass: { anyOf: [{ type: "string" }, { type: "null" }] },
              specification: { anyOf: [{ type: "string" }, { type: "null" }] },
              shift: { anyOf: [{ type: "string" }, { type: "null" }] }
            }
          },
          canonicalUnit: { type: "string" },
          pricingBasis: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string" }
        }
      }
    }
  }
} as const;

export class OpenAICatalogNormalizer implements CatalogNormalizer {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAINormalizerOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model =
      options.model ?? process.env.OPENAI_NORMALIZATION_MODEL ?? "gpt-4o-mini";
    this.endpoint = options.endpoint ?? "https://api.openai.com/v1/responses";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async normalize(input: {
    userId: string;
    lines: NormalizationSourceLine[];
    catalog: NormalizationCatalogContext[];
    existingCategories: string[];
  }): Promise<CatalogNormalizationResponse> {
    if (!this.apiKey) {
      throw new Error(
        "OPENAI_API_KEY is required for AI catalog normalization."
      );
    }
    if (input.lines.length === 0) return { lines: [] };

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        ...(/^(?:o\d|gpt-5)/i.test(this.model)
          ? { reasoning: { effort: "low" } }
          : {}),
        safety_identifier: createHash("sha256")
          .update(input.userId)
          .digest("hex"),
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "Normalize event-procurement quote lines into precise base catalog profiles and variants. " +
                  "Reuse an existing catalogItemId whenever the real-world service is the same. Put dimensions, " +
                  "capacity, vehicle tonnage, power rating, shift, or specification in variant attributes, not the " +
                  "base name. Never merge protected differences such as generator kVA, gazebo size, truck tonnage, " +
                  "day/night staffing, per-kilometre/per-trip, or hourly/daily pricing. Use ZAR ex-VAT comparison " +
                  "bases. Create a base profile only when no existing profile is defensibly equivalent. Return one " +
                  "result for every input line and do not invent source facts. " +
                  `\n\nWhen classifying the category, prefer these existing categories if it matches perfectly: ${input.existingCategories.join(", ")}. ` +
                  "If the service does not fit any of the existing categories, you are free to invent a new concise, professional category name (e.g. 'Logistics', 'Medical')."
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  existingCatalog: input.catalog,
                  extractedLines: input.lines
                })
              }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "quote_catalog_normalization",
            strict: true,
            schema: responseJsonSchema
          },
          verbosity: "medium"
        }
      })
    });

    const rawBody = await response.text();
    if (!response.ok) {
      throw new Error(
        `OpenAI normalization failed (${response.status}): ${rawBody.slice(0, 600)}`
      );
    }

    const payload: unknown = rawBody ? JSON.parse(rawBody) : {};
    const outputText = extractOutputText(payload);
    if (!outputText) {
      throw new Error("OpenAI normalization returned no structured output.");
    }

    const parsed: unknown = JSON.parse(outputText);
    return catalogNormalizationResponseSchema.parse(
      removeNullVariantAttributes(parsed)
    );
  }
}

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.output)) return null;

  for (const output of record.output) {
    if (!output || typeof output !== "object") continue;
    const content = (output as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const text = (item as Record<string, unknown>).text;
      if (typeof text === "string") return text;
    }
  }
  return null;
}

function removeNullVariantAttributes(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.lines)) return payload;
  return {
    ...record,
    lines: record.lines.map((line) => {
      if (!line || typeof line !== "object") return line;
      const lineRecord = line as Record<string, unknown>;
      const attributes = lineRecord.variantAttributes;
      return {
        ...lineRecord,
        variantAttributes:
          attributes && typeof attributes === "object"
            ? Object.fromEntries(
                Object.entries(attributes as Record<string, unknown>).filter(
                  ([, value]) => typeof value === "string" && value.trim()
                )
              )
            : {}
      };
    })
  };
}
