import type {
  CatalogDetailResponse,
  CatalogSummary,
  CreateCatalogItemInput,
  CreateSupplierInput,
  DateRangeQuery,
  IngestionRunAudit,
  PaginatedCatalogResponse,
  ReassignLineItemInput,
  ReassignLineItemResult,
  UnmatchedLineItemsResponse,
  StatsResponse,
  SupplierAnalytics,
  UploadQuoteResponse
} from "@quote-intelligence/domain";

export interface QuoteUploadProgress {
  phase: "uploading" | "parsing";
  percent: number | null;
}

function uploadQuote(
  file: File,
  onProgress: (progress: QuoteUploadProgress) => void
): Promise<UploadQuoteResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/ingest/upload");
    xhr.timeout = 8 * 60 * 1000;
    xhr.upload.onprogress = (event) => {
      onProgress({
        phase: "uploading",
        percent: event.lengthComputable
          ? Math.min(100, Math.round((event.loaded / event.total) * 100))
          : null
      });
    };
    xhr.upload.onload = () => onProgress({ phase: "parsing", percent: null });
    xhr.onerror = () => reject(new Error("The quote upload could not reach the API."));
    xhr.ontimeout = () => reject(new Error("Document parsing timed out. Please try again."));
    xhr.onload = () => {
      const payload = (() => {
        try {
          return JSON.parse(xhr.responseText) as UploadQuoteResponse & {
            error?: string;
            message?: string;
          };
        } catch {
          return null;
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300 && payload) {
        resolve(payload);
        return;
      }
      reject(new Error(
        payload?.message ?? payload?.error ?? `Upload failed with status ${xhr.status}.`
      ));
    };
    onProgress({ phase: "uploading", percent: 0 });
    xhr.send(form);
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new Error(payload?.message ?? payload?.error ?? `Request failed with status ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  stats: () => request<StatsResponse>("/api/stats"),
  catalog: (query: string, page = 1, pageSize = 24) =>
    request<PaginatedCatalogResponse>(
      `/api/catalog?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`
    ),
  createCatalogItem: (input: CreateCatalogItemInput) =>
    request<CatalogSummary>("/api/catalog", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  deleteCatalogItem: (id: string) =>
    request<{ success: boolean }>(`/api/catalog/${id}`, { method: "DELETE" }),
  catalogDetail: (id: string) => request<CatalogDetailResponse>(`/api/catalog/${id}`),
  unmatchedLineItems: () =>
    request<UnmatchedLineItemsResponse>("/api/line-items/unmatched"),
  reassign: (lineItemId: string, input: ReassignLineItemInput) =>
    request<ReassignLineItemResult>(
      `/api/line-items/${lineItemId}/reassign`,
      { method: "POST", body: JSON.stringify(input) }
    ),
  suppliers: (range: DateRangeQuery = {}) => {
    const params = new URLSearchParams();
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    const query = params.toString();
    return request<SupplierAnalytics[]>(`/api/suppliers${query ? `?${query}` : ""}`);
  },
  createSupplier: (input: CreateSupplierInput) =>
    request<{ id: string; name: string }>("/api/suppliers", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  deleteSupplier: (id: string) =>
    request<{ success: boolean }>(`/api/suppliers/${id}`, { method: "DELETE" }),
  ingestionAudit: () => request<IngestionRunAudit[]>("/api/ingestion-runs"),
  uploadQuote
};
