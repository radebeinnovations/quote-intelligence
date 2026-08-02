import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CatalogSummary, PaginatedCatalogResponse } from "@quote-intelligence/domain";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { CatalogBrowser } from "./CatalogBrowser";

const items: CatalogSummary[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Zulu Transport",
    description: null,
    category: "Transport",
    primaryUnit: "trip",
    linkedLineItemCount: 4,
    supplierCount: 3,
    minPrice: 90,
    maxPrice: 110,
    fairPrice: 100,
    lastUploadedAt: "2026-07-30T10:00:00.000Z",
    variants: []
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Bravo Generator",
    description: null,
    category: "Power",
    primaryUnit: "item-day",
    linkedLineItemCount: 2,
    supplierCount: 1,
    minPrice: 180,
    maxPrice: 220,
    fairPrice: 200,
    lastUploadedAt: "2026-07-31T10:00:00.000Z",
    variants: []
  }
];

const catalogPage: PaginatedCatalogResponse = {
  items,
  page: 1,
  pageSize: 50,
  total: items.length,
  totalPages: 1
};

describe("catalog filters", () => {
  it("forwards category and multi-column sorting to the API", async () => {
    const catalog = vi.spyOn(api, "catalog").mockResolvedValue(catalogPage);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <CatalogBrowser onSelect={vi.fn()} />
      </QueryClientProvider>
    );

    await screen.findByRole("button", {
      name: "Open Bravo Generator price intelligence"
    });
    expect(catalog).toHaveBeenCalledWith("", 1, 50, {
      sortBy: "name",
      sortOrder: "asc"
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), {
      target: { value: "fairPrice:desc" }
    });
    await waitFor(() =>
      expect(catalog).toHaveBeenCalledWith("", 1, 50, {
        sortBy: "fairPrice",
        sortOrder: "desc"
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Power" }));
    await waitFor(() =>
      expect(catalog).toHaveBeenCalledWith("", 1, 50, {
        category: "Power",
        sortBy: "fairPrice",
        sortOrder: "desc"
      })
    );
  });
});
