import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CATALOG_CATEGORIES,
  type CatalogCategory,
  type CatalogSortBy,
  type SortOrder
} from "@quote-intelligence/domain";
import { useEffect, useState } from "react";
import { api } from "../api";
import { downloadCsv } from "../csv";
import {
  resolveDateRange,
  type DateRangePreset
} from "../date-range";
import { formatDate, formatNumber, zar } from "../format";
import { CreateCatalogItemModal } from "./CreateCatalogItemModal";
import { DateRangeSelector } from "./DateRangeSelector";

const sortOptions: Array<{
  value: `${CatalogSortBy}:${SortOrder}`;
  label: string;
}> = [
  { value: "name:asc", label: "Name: A–Z" },
  { value: "name:desc", label: "Name: Z–A" },
  { value: "fairPrice:asc", label: "Fair price: Low–High" },
  { value: "fairPrice:desc", label: "Fair price: High–Low" },
  { value: "supplierCount:desc", label: "Suppliers: Most–Least" },
  { value: "supplierCount:asc", label: "Suppliers: Least–Most" }
];

function categoryLabel(category: CatalogCategory): string {
  return category === "Equipment hire" ? "Equipment Hire" : category;
}

export function CatalogBrowser({
  onSelect,
  onUpload = () => undefined
}: {
  onSelect: (id: string, variantIds?: string[]) => void;
  onUpload?: () => void;
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CatalogCategory | "">("");
  const [sortBy, setSortBy] = useState<CatalogSortBy>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [dateRangePreset, setDateRangePreset] =
    useState<DateRangePreset>("all-time");
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [input]);

  const catalog = useQuery({
    queryKey: [
      "catalog",
      query,
      category,
      sortBy,
      sortOrder,
      dateRangePreset
    ],
    queryFn: () =>
      api.catalog(query, 1, 50, {
        ...(category ? { category } : {}),
        sortBy,
        sortOrder,
        ...resolveDateRange(dateRangePreset)
      })
  });

  function exportCsv() {
    if (!catalog.data?.items) return;
    const header = [
      "Service Name",
      "Category",
      "Primary Unit",
      "Fair Price Ex-VAT (ZAR)",
      "Min Rate Ex-VAT",
      "Max Rate Ex-VAT",
      "Suppliers Count",
      "Linked Lines Count"
    ];
    const rows = catalog.data.items.map((item) => [
      item.name,
      item.category,
      item.primaryUnit,
      item.fairPrice ?? "",
      item.minPrice ?? "",
      item.maxPrice ?? "",
      item.supplierCount,
      item.linkedLineItemCount
    ]);
    downloadCsv("procurement-catalog-benchmark.csv", [header, ...rows]);
  }

  function selectSort(value: string) {
    const option = sortOptions.find((item) => item.value === value);
    if (!option) return;
    const [nextSortBy, nextSortOrder] = option.value.split(":") as [
      CatalogSortBy,
      SortOrder
    ];
    setSortBy(nextSortBy);
    setSortOrder(nextSortOrder);
  }

  async function handleDelete(itemId: string, itemName: string) {
    if (!window.confirm(
      `Deactivate "${itemName}"? Historical price observations remain in the audit trail.`
    )) return;
    try {
      await api.deleteCatalogItem(itemId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["stats"] }),
        queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
        queryClient.invalidateQueries({ queryKey: ["unmatched-line-items"] })
      ]);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to deactivate service.");
    }
  }

  return (
    <section className="catalog-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Procurement catalog</p>
          <h2>Comparable services, one clear view.</h2>
          <p>Every price below is normalized to an ex-VAT comparison basis.</p>
        </div>
        <div className="page-actions">
          <button className="button primary compact" onClick={onUpload}>
            + Upload quotes
          </button>
          <button className="button secondary compact" onClick={() => setShowCreateModal(true)}>
            + Add service
          </button>
          <button
            className="button secondary compact"
            onClick={exportCsv}
            disabled={!catalog.data?.items.length}
          >
            ↓ Export CSV
          </button>
        </div>
        <div className="catalog-controls">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Search services or descriptions"
              aria-label="Search catalog"
            />
          </label>
          <label className="catalog-select category-dropdown">
            <span>Category</span>
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as CatalogCategory | "")
              }
            >
              <option value="">All categories</option>
              {CATALOG_CATEGORIES.map((item) => (
                <option value={item} key={item}>
                  {categoryLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <DateRangeSelector
            value={dateRangePreset}
            onChange={setDateRangePreset}
          />
          <label className="catalog-select sort-select">
            <span>Sort</span>
            <select
              value={`${sortBy}:${sortOrder}`}
              onChange={(event) => selectSort(event.target.value)}
            >
              {sortOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="category-filter-strip" aria-label="Filter catalog by category">
        <button
          type="button"
          className={category === "" ? "active" : ""}
          aria-pressed={category === ""}
          onClick={() => setCategory("")}
        >
          All
        </button>
        {CATALOG_CATEGORIES.map((item) => (
          <button
            type="button"
            key={item}
            className={category === item ? "active" : ""}
            aria-pressed={category === item}
            onClick={() => setCategory(item)}
          >
            {categoryLabel(item)}
          </button>
        ))}
      </div>

      {catalog.isLoading && <CatalogSkeleton />}
      {catalog.isError && <ErrorState message={catalog.error.message} />}
      {catalog.data?.items.length === 0 &&
        (query || category || dateRangePreset !== "all-time" ? (
          <div className="empty-state">
            <span>∅</span>
            <h3>No catalog services found</h3>
            <p>Nothing matches the current search, category, and date filters.</p>
          </div>
        ) : (
          <div className="bootstrap-callout panel">
            <span className="bootstrap-icon" aria-hidden="true">✦</span>
            <div>
              <p className="eyebrow">Empty workspace</p>
              <h3>Bootstrap your catalog</h3>
              <p>
                Drop a batch of supplier PDF/XLSX quotes. DocuPipe extracts the raw
                lines and AI normalization creates deduplicated base profiles with
                filterable variants.
              </p>
            </div>
            <button className="button primary" onClick={onUpload}>
              Upload your first quotes
            </button>
          </div>
        ))}

      <div className="catalog-grid">
        {catalog.data?.items.map((item) => (
          <article
            className="catalog-card"
            key={item.id}
          >
            <button
              className="catalog-card-hitbox"
              onClick={() => onSelect(item.id)}
              aria-label={`Open ${item.name} price intelligence`}
            />
            <div className="card-topline catalog-card-content">
              <span className="category-pill">{item.category}</span>
              <div className="card-topline-actions">
                <button
                  type="button"
                  className="delete-icon-btn"
                  aria-label={`Deactivate ${item.name}`}
                  onClick={() => void handleDelete(item.id, item.name)}
                >
                  ×
                </button>
                <span className="arrow">↗</span>
              </div>
            </div>
            <h3 className="catalog-card-content">{item.name}</h3>
            <p className="catalog-card-content">{item.description ?? "Canonical service with linked supplier pricing."}</p>
            <small className="catalog-uploaded-date catalog-card-content">
              {item.lastUploadedAt
                ? `Last uploaded ${formatDate(item.lastUploadedAt)}`
                : "No uploaded quote date"}
            </small>
            {item.variants.length > 0 && (
              <div className="variant-preview catalog-card-content" aria-label={`${item.name} variants`}>
                {item.variants.slice(0, 4).map((variant) => (
                  <button
                    type="button"
                    className="variant-pill"
                    key={variant.id}
                    onClick={() => onSelect(item.id, [variant.id])}
                    aria-label={`Open ${item.name}, ${variant.label}`}
                  >
                    {variant.label}
                  </button>
                ))}
                {item.variants.length > 4 && (
                  <span className="variant-pill">+{item.variants.length - 4}</span>
                )}
              </div>
            )}
            <div className="fair-price-row catalog-card-content">
              <span>Fair price</span>
              <strong>{item.fairPrice === null ? "Insufficient data" : zar.format(item.fairPrice)}</strong>
              <small>per {item.primaryUnit}</small>
            </div>
            <dl className="card-metrics catalog-card-content">
              <div>
                <dt>Suppliers</dt>
                <dd>{formatNumber(item.supplierCount)}</dd>
              </div>
              <div>
                <dt>Rate range</dt>
                <dd>
                  {item.minPrice === null || item.maxPrice === null
                    ? "—"
                    : `${zar.format(item.minPrice)} – ${zar.format(item.maxPrice)}`}
                </dd>
              </div>
              <div>
                <dt>Linked lines</dt>
                <dd>{formatNumber(item.linkedLineItemCount)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      {showCreateModal && (
        <CreateCatalogItemModal
          onClose={() => setShowCreateModal(false)}
          onSaved={() => {
            setShowCreateModal(false);
            void queryClient.invalidateQueries({ queryKey: ["catalog"] });
            void queryClient.invalidateQueries({ queryKey: ["stats"] });
          }}
        />
      )}
    </section>
  );
}

function CatalogSkeleton() {
  return (
    <div className="catalog-grid" aria-label="Loading catalog">
      {[1, 2, 3, 4, 5, 6].map((item) => (
        <div className="catalog-card skeleton" key={item} />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="error-state">
      <strong>Catalog data is unavailable</strong>
      <p>{message}</p>
      <small>Check that the API and Supabase environment are running.</small>
    </div>
  );
}
