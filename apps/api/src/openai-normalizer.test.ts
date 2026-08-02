import { describe, expect, it, vi } from "vitest";
import { OpenAICatalogNormalizer } from "./openai-normalizer";

const lineId = "line-1";
const catalogId = "11111111-1111-4111-8111-111111111111";

describe("OpenAI catalog normalization", () => {
  it("uses strict structured output and validates a base-profile variant match", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(request).toMatchObject({
        model: "gpt-4o-mini",
        text: {
          format: {
            type: "json_schema",
            name: "quote_catalog_normalization",
            strict: true
          }
        }
      });
      expect(request.safety_identifier).toMatch(/^[a-f0-9]{64}$/);

      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            lines: [
              {
                lineItemId: lineId,
                action: "match",
                catalogItemId: catalogId,
                baseName: "White Gazebo",
                category: "Equipment hire",
                variantLabel: "3 m × 3 m",
                variantAttributes: {
                  size: "3 m × 3 m",
                  capacity: null,
                  weightClass: null,
                  specification: "white",
                  shift: null
                },
                canonicalUnit: "item-day",
                pricingBasis: "item-day",
                confidence: 0.96,
                rationale: "Same base gazebo with an explicit size variant."
              }
            ]
          })
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const normalizer = new OpenAICatalogNormalizer({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchImpl: fetchImpl as typeof fetch
    });
    const result = await normalizer.normalize({
      userId: "tenant-a",
      catalog: [
        {
          id: catalogId,
          name: "White Gazebo",
          category: "Equipment hire",
          canonicalUnit: "item-day",
          pricingBasis: "item-day",
          variants: []
        }
      ],
      lines: [
        {
          lineItemId: lineId,
          description: "White Gazebo 3m x 3m",
          unit: "day",
          quantity: 1
        }
      ]
    });

    expect(result.lines[0]).toMatchObject({
      catalogItemId: catalogId,
      baseName: "White Gazebo",
      variantAttributes: { size: "3 m × 3 m", specification: "white" }
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not call OpenAI for an empty line set", async () => {
    const fetchImpl = vi.fn();
    const normalizer = new OpenAICatalogNormalizer({
      apiKey: "test-key",
      fetchImpl: fetchImpl as typeof fetch
    });

    await expect(
      normalizer.normalize({ userId: "tenant-a", catalog: [], lines: [] })
    ).resolves.toEqual({ lines: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails clearly when the server-side OpenAI credential is absent", async () => {
    const normalizer = new OpenAICatalogNormalizer({ apiKey: "" });
    await expect(
      normalizer.normalize({
        userId: "tenant-a",
        catalog: [],
        lines: [{ lineItemId: lineId, description: "Table", unit: "each", quantity: 1 }]
      })
    ).rejects.toThrow("OPENAI_API_KEY");
  });
});
