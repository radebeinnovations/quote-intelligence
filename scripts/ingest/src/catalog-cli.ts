import { createServiceDatabaseClient } from "@quote-intelligence/database";
import { normalizeCatalogRate } from "@quote-intelligence/domain";
import "./config";
import { catalogRules, findCatalogRule, type CatalogRule } from "./catalog-rules";

interface LineRow {
  id: string;
  description_raw: string;
  unit_raw: string;
  unit_rate_ex_vat: number | string | null;
}

interface CatalogRow {
  id: string;
  name: string;
}

const database = createServiceDatabaseClient();

async function upsertCatalog(): Promise<Map<string, string>> {
  const rows = catalogRules.map((item) => ({
    name: item.name,
    category: item.category,
    description: item.description,
    canonical_unit: item.canonicalUnit,
    canonical_pricing_basis: item.canonicalBasis,
    attributes: { generatedBy: "catalog-rules-v1" },
    active: true
  }));
  const { data, error } = await database
    .from("catalog_items")
    .upsert(rows, { onConflict: "name" })
    .select("id,name");
  if (error) throw error;
  return new Map(((data ?? []) as CatalogRow[]).map(({ id, name }) => [name, id]));
}

function normalizePrice(line: LineRow, match: CatalogRule) {
  const parsedRate = line.unit_rate_ex_vat === null ? null : Number(line.unit_rate_ex_vat);
  const rate = parsedRate !== null && Number.isFinite(parsedRate) ? parsedRate : null;
  return normalizeCatalogRate(rate, line.unit_raw, match.canonicalBasis);
}

async function main() {
  const catalogIds = await upsertCatalog();
  const { data, error } = await database
    .from("quote_line_items")
    .select("id,description_raw,unit_raw,unit_rate_ex_vat");
  if (error) throw error;

  let matched = 0;
  let unmatched = 0;
  for (const line of (data ?? []) as LineRow[]) {
    const match = findCatalogRule(line.description_raw);
    if (!match) {
      const { error: matchError } = await database.from("catalog_matches").upsert(
        {
          line_item_id: line.id,
          catalog_item_id: null,
          status: "unmatched",
          method: null,
          confidence: null,
          reason_codes: ["NO_CONSERVATIVE_RULE"]
        },
        { onConflict: "line_item_id" }
      );
      if (matchError) throw matchError;
      unmatched += 1;
      continue;
    }

    const catalogItemId = catalogIds.get(match.name);
    if (!catalogItemId) throw new Error(`Missing catalog item for ${match.name}`);
    const normalized = normalizePrice(line, match);
    const { error: matchError } = await database.from("catalog_matches").upsert(
      {
        line_item_id: line.id,
        catalog_item_id: catalogItemId,
        status: "matched",
        method: "exact_rule",
        confidence: 0.98,
        reason_codes: ["ALIASED_DESCRIPTION", "PROTECTED_ATTRIBUTES_COMPATIBLE"]
      },
      { onConflict: "line_item_id" }
    );
    if (matchError) throw matchError;
    const { error: normalizationError } = await database.from("price_normalizations").upsert(
      {
        line_item_id: line.id,
        canonical_rate_ex_vat: normalized.canonicalRate,
        canonical_basis: normalized.canonicalBasis,
        estimated: normalized.estimated,
        comparable: normalized.comparable,
        explanation: normalized.explanation
      },
      { onConflict: "line_item_id" }
    );
    if (normalizationError) throw normalizationError;
    matched += 1;
  }

  console.log(JSON.stringify({ catalogItems: catalogRules.length, matched, unmatched }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
