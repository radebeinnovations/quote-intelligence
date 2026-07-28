import type {
  CatalogDetailResponse,
  PaginatedCatalogResponse,
  ReassignLineItemInput,
  ReassignLineItemResult,
  UnmatchedLineItemsResponse,
  StatsResponse
} from "@quote-intelligence/domain";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed with status ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  stats: () => request<StatsResponse>("/api/stats"),
  catalog: (query: string, page = 1, pageSize = 24) =>
    request<PaginatedCatalogResponse>(
      `/api/catalog?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`
    ),
  catalogDetail: (id: string) => request<CatalogDetailResponse>(`/api/catalog/${id}`),
  unmatchedLineItems: () =>
    request<UnmatchedLineItemsResponse>("/api/line-items/unmatched"),
  reassign: (lineItemId: string, input: ReassignLineItemInput) =>
    request<ReassignLineItemResult>(
      `/api/line-items/${lineItemId}/reassign`,
      { method: "POST", body: JSON.stringify(input) }
    )
};
