import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  PaginatedCatalogResponse,
  StatsResponse,
  UploadQuoteResponse
} from "@quote-intelligence/domain";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { api } from "../api";
import { UploadQuoteModal } from "./UploadQuoteModal";

const uploadResponse: UploadQuoteResponse = {
  idempotent: false,
  sha256: "a".repeat(64),
  filename: "Test_Quote_Protea_Events.xlsx",
  supplier: { id: "11111111-1111-4111-8111-111111111111", name: "Protea Events" },
  quote: {
    id: "22222222-2222-4222-8222-222222222222",
    quoteNumber: "PE-001",
    quoteDate: "2026-07-31",
    currency: "ZAR",
    total: 805
  },
  lineItems: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      sourceRow: "8",
      description: "Waiter per hour",
      quantity: 2,
      unit: "hour",
      unitRate: 100,
      lineTotal: 200,
      match: {
        catalogItemId: "44444444-4444-4444-8444-444444444444",
        catalogItemName: "Waitstaff",
        status: "matched",
        confidence: 0.98
      }
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      sourceRow: "9",
      description: "Custom protea floral installation",
      quantity: 1,
      unit: "each",
      unitRate: 500,
      lineTotal: 500,
      match: {
        catalogItemId: null,
        catalogItemName: null,
        status: "unmatched",
        confidence: null
      }
    }
  ],
  warnings: []
};

const initialStats: StatsResponse = {
  totalQuotes: 51,
  totalSuppliers: 10,
  catalogItemCount: 37,
  totalLineItems: 174,
  dateRange: { from: "2025-08-03", to: "2026-07-15" }
};

const updatedStats: StatsResponse = {
  totalQuotes: 52,
  totalSuppliers: 11,
  catalogItemCount: 38,
  totalLineItems: 176,
  dateRange: { from: "2025-08-03", to: "2026-07-31" }
};

const emptyCatalog: PaginatedCatalogResponse = {
  items: [],
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 0
};

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
}

function provider(client: QueryClient, children: ReactNode) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function uploadFile(): File {
  return new File(
    [new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
    "Test_Quote_Protea_Events.xlsx",
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
  );
}

function statCard(label: string): HTMLElement {
  const card = screen
    .getAllByText(label)
    .map((element) => element.closest<HTMLElement>("article.stat-card"))
    .find((element): element is HTMLElement => element !== null);
  if (!card) throw new Error(`Missing ${label} stat card.`);
  return card;
}

describe("quote upload query synchronization", () => {
  it("invalidates every metric, catalog, supplier, review, and audit query", async () => {
    const client = testQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    vi.spyOn(api, "uploadQuote").mockImplementation(async (_file, onProgress) => {
      onProgress({ phase: "parsing", percent: null });
      return uploadResponse;
    });

    render(provider(client, <UploadQuoteModal onClose={vi.fn()} />));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("Missing quote file input.");
    fireEvent.change(input, { target: { files: [uploadFile()] } });

    expect(await screen.findByText("Protea Events")).toBeVisible();
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(5));
    const invalidatedKeys = invalidate.mock.calls.map(([filters]) =>
      (filters as { queryKey?: readonly unknown[] }).queryKey
    );
    expect(invalidatedKeys).toEqual(expect.arrayContaining([
      ["stats"],
      ["catalog"],
      ["suppliers"],
      ["unmatched-line-items"],
      ["ingestion-audit"]
    ]));
  });

  it("re-renders the top stats from refetched data without a page refresh", async () => {
    window.history.replaceState({}, "", "/");
    const client = testQueryClient();
    const stats = vi.spyOn(api, "stats")
      .mockResolvedValueOnce(initialStats)
      .mockResolvedValue(updatedStats);
    vi.spyOn(api, "catalog").mockResolvedValue(emptyCatalog);
    vi.spyOn(api, "uploadQuote").mockImplementation(async (_file, onProgress) => {
      onProgress({ phase: "parsing", percent: null });
      return uploadResponse;
    });

    render(provider(client, <App />));
    expect(await within(statCard("Quotes")).findByText("51")).toBeVisible();
    expect(within(statCard("Suppliers")).getByText("10")).toBeVisible();
    expect(within(statCard("Catalog services")).getByText("37")).toBeVisible();
    expect(within(statCard("Extracted lines")).getByText("174")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /upload quote pdf/i }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("Missing quote file input.");
    fireEvent.change(input, { target: { files: [uploadFile()] } });

    await waitFor(() => {
      expect(within(statCard("Quotes")).getByText("52")).toBeVisible();
      expect(within(statCard("Suppliers")).getByText("11")).toBeVisible();
      expect(within(statCard("Catalog services")).getByText("38")).toBeVisible();
      expect(within(statCard("Extracted lines")).getByText("176")).toBeVisible();
    });
    expect(stats).toHaveBeenCalledTimes(2);
  });
});
