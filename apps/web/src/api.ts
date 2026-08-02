import type {
  CatalogCategory,
  CatalogDetailResponse,
  CatalogSortBy,
  DateRangeQuery,
  BatchQuoteUploadInput,
  BatchQuoteUploadResult,
  CatalogSummary,
  CreateCatalogItemInput,
  CreateSupplierInput,
  PaginatedCatalogResponse,
  ReassignLineItemInput,
  ReassignLineItemResult,
  SortOrder,
  UnmatchedLineItemsResponse,
  StatsResponse,
  SupplierPerformance,
  SupplierProfileResponse,
  IngestionRunAudit,
  UploadQuoteResponse
} from "@quote-intelligence/domain";

let accessToken: string | null = null;

export function setApiAccessToken(token: string | null): void {
  accessToken = token;
}

interface CatalogRequestOptions extends DateRangeQuery {
  category?: CatalogCategory;
  sortBy?: CatalogSortBy;
  sortOrder?: SortOrder;
}

export interface QuoteUploadProgress {
  phase: "uploading" | "parsing";
  percent: number | null;
}

function addDateRange(params: URLSearchParams, range: DateRangeQuery): void {
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(path, {
    ...init,
    headers
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed with status ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  stats: () => request<StatsResponse>("/api/stats"),
  catalog: (
    query: string,
    page = 1,
    pageSize = 50,
    options: CatalogRequestOptions = {}
  ) => {
    const params = new URLSearchParams({
      q: query,
      page: String(page),
      pageSize: String(pageSize),
      sortBy: options.sortBy ?? "name",
      sortOrder: options.sortOrder ?? "asc"
    });
    if (options.category) params.set("category", options.category);
    addDateRange(params, options);
    return request<PaginatedCatalogResponse>(`/api/catalog?${params.toString()}`);
  },
  catalogDetail: (id: string, variantIds: string[] = []) => {
    const params = new URLSearchParams();
    if (variantIds.length) params.set("variantIds", variantIds.join(","));
    const query = params.toString();
    return request<CatalogDetailResponse>(
      `/api/catalog/${id}${query ? `?${query}` : ""}`
    );
  },
  createCatalogItem: (input: CreateCatalogItemInput) =>
    request<CatalogSummary>("/api/catalog", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  deleteCatalogItem: (id: string) =>
    request<{ success: boolean }>(`/api/catalog/${id}`, { method: "DELETE" }),
  unmatchedLineItems: () =>
    request<UnmatchedLineItemsResponse>("/api/line-items/unmatched"),
  reassign: (lineItemId: string, input: ReassignLineItemInput) =>
    request<ReassignLineItemResult>(
      `/api/line-items/${lineItemId}/reassign`,
      { method: "POST", body: JSON.stringify(input) }
    ),
  suppliers: (range: DateRangeQuery = {}) => {
    const params = new URLSearchParams();
    addDateRange(params, range);
    const query = params.toString();
    return request<SupplierPerformance[]>(
      `/api/suppliers${query ? `?${query}` : ""}`
    );
  },
  createSupplier: (input: CreateSupplierInput) =>
    request<{ id: string; name: string }>("/api/suppliers", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  deleteSupplier: (id: string) =>
    request<{ success: boolean }>(`/api/suppliers/${id}`, { method: "DELETE" }),
  ingestionAudit: () => request<IngestionRunAudit[]>("/api/ingestion-audit"),
  supplierProfile: (id: string) =>
    request<SupplierProfileResponse>(`/api/suppliers/${id}`),
  uploadQuotes: (input: BatchQuoteUploadInput) =>
    request<BatchQuoteUploadResult>("/api/uploads/batch", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  uploadQuote: (file: File, onProgress: (progress: QuoteUploadProgress) => void) =>
    uploadQuote(file, onProgress)
};

function uploadQuote(
  file: File,
  onProgress: (progress: QuoteUploadProgress) => void
): Promise<UploadQuoteResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/ingest/upload");
    if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.timeout = 8 * 60 * 1000;
    xhr.upload.onprogress = (event) =>
      onProgress({
        phase: "uploading",
        percent: event.lengthComputable
          ? Math.min(100, Math.round((event.loaded / event.total) * 100))
          : null
      });
    xhr.upload.onload = () => onProgress({ phase: "parsing", percent: null });
    xhr.onerror = () => reject(new Error("The quote upload could not reach the API."));
    xhr.onabort = () => reject(new Error("The quote upload was cancelled."));
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
      if (xhr.status >= 200 && xhr.status < 300 && payload) resolve(payload);
      else reject(new Error(payload?.message ?? payload?.error ?? `Upload failed with status ${xhr.status}.`));
    };
    onProgress({ phase: "uploading", percent: 0 });
    xhr.send(form);
  });
}
