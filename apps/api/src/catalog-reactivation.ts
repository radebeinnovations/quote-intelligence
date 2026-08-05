import type { SupabaseClient } from "@supabase/supabase-js";

interface IdRow {
  id: string;
}

interface CatalogMatchRow {
  catalog_item_id: string | null;
}

export async function reactivateCatalogItemIds(
  database: SupabaseClient,
  userId: string,
  catalogItemIds: string[]
): Promise<number> {
  const uniqueIds = [...new Set(catalogItemIds.filter(Boolean))];
  if (uniqueIds.length === 0) return 0;

  const { error } = await database
    .from("catalog_items")
    .update({ active: true })
    .eq("user_id", userId)
    .in("id", uniqueIds);
  if (error) throw error;
  return uniqueIds.length;
}

export async function reactivateSourceCatalogItems(
  database: SupabaseClient,
  userId: string,
  sourceDocumentId: string
): Promise<number> {
  const { data: quotes, error: quoteError } = await database
    .from("quotes")
    .select("id")
    .eq("user_id", userId)
    .eq("source_document_id", sourceDocumentId);
  if (quoteError) throw quoteError;
  const quoteIds = ((quotes ?? []) as IdRow[]).map(({ id }) => id);
  if (quoteIds.length === 0) return 0;

  const { data: lines, error: lineError } = await database
    .from("quote_line_items")
    .select("id")
    .eq("user_id", userId)
    .in("quote_id", quoteIds);
  if (lineError) throw lineError;
  const lineIds = ((lines ?? []) as IdRow[]).map(({ id }) => id);
  if (lineIds.length === 0) return 0;

  const { data: matches, error: matchError } = await database
    .from("catalog_matches")
    .select("catalog_item_id")
    .eq("user_id", userId)
    .in("line_item_id", lineIds);
  if (matchError) throw matchError;
  const catalogItemIds = ((matches ?? []) as CatalogMatchRow[]).flatMap(
    ({ catalog_item_id }) => (catalog_item_id ? [catalog_item_id] : [])
  );
  return reactivateCatalogItemIds(database, userId, catalogItemIds);
}
