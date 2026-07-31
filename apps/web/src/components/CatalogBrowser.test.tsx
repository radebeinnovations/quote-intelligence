import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CatalogSummary, PaginatedCatalogResponse } from "@quote-intelligence/domain";
import { fireEvent, render, screen } from "@testing-library/react";
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
    lastUploadedAt: "2026-07-30T10:00:00.000Z"
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Alpha Review Service",
    description: null,
    category: "General",
    primaryUnit: "item",
    linkedLineItemCount: 9,
    supplierCount: 5,
    minPrice: null,
    maxPrice: null,
    fairPrice: null,
    lastUploadedAt: null
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Bravo Generator",
    description: null,
    category: "Power",
    primaryUnit: "item-day",
    linkedLineItemCount: 2,
    supplierCount: 1,
    minPrice: 180,
    maxPrice: 220,
    fairPrice: 200,
    lastUploadedAt: "2026-07-31T10:00:00.000Z"
  }
];

const catalogPage: PaginatedCatalogResponse = {
  items,
  page: 1,
  pageSize: 50,
  total: items.length,
  totalPages: 1
};

function visibleOrder(): string[] {
  return screen.getAllByRole("button", { name: /^View / }).map(
    (button) => button.getAttribute("aria-label")?.replace(/^View /, "") ?? ""
  );
}

describe("catalog sorting", () => {
  it("sorts visible catalog cards and leaves missing prices last", async () => {
    vi.spyOn(api, "catalog").mockResolvedValue(catalogPage);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <CatalogBrowser onSelect={vi.fn()} />
      </QueryClientProvider>
    );

    await screen.findByRole("button", { name: "View Alpha Review Service" });
    expect(visibleOrder()).toEqual([
      "Alpha Review Service",
      "Bravo Generator",
      "Zulu Transport"
    ]);

    fireEvent.change(screen.getByRole("combobox", { name: "Sort catalog services" }), {
      target: { value: "price-desc" }
    });
    expect(visibleOrder()).toEqual([
      "Bravo Generator",
      "Zulu Transport",
      "Alpha Review Service"
    ]);

    fireEvent.change(screen.getByRole("combobox", { name: "Sort catalog services" }), {
      target: { value: "uploaded-desc" }
    });
    expect(visibleOrder()).toEqual([
      "Bravo Generator",
      "Zulu Transport",
      "Alpha Review Service"
    ]);

    fireEvent.change(screen.getByRole("combobox", { name: "Sort catalog services" }), {
      target: { value: "lines-desc" }
    });
    expect(visibleOrder()).toEqual([
      "Alpha Review Service",
      "Zulu Transport",
      "Bravo Generator"
    ]);
  });
});
