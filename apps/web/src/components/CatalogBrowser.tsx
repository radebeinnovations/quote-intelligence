import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CatalogSummary } from "@quote-intelligence/domain";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { formatDate, formatNumber, zar } from "../format";
import { CreateCatalogItemModal } from "./CreateCatalogItemModal";

export type CatalogSortOption =
  | "name-asc"
  | "name-desc"
  | "price-asc"
  | "price-desc"
  | "uploaded-desc"
  | "suppliers-desc"
  | "lines-desc";

const catalogSortOptions: Array<{ value: CatalogSortOption; label: string }> = [
  { value: "name-asc", label: "Name: A–Z" },
  { value: "name-desc", label: "Name: Z–A" },
  { value: "price-asc", label: "Fair price: Low–High" },
  { value: "price-desc", label: "Fair price: High–Low" },
  { value: "uploaded-desc", label: "Last uploaded" },
  { value: "suppliers-desc", label: "Most suppliers" },
  { value: "lines-desc", label: "Most linked lines" }
];

const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base"
});

export function sortCatalogItems(
  items: CatalogSummary[],
  sort: CatalogSortOption
): CatalogSummary[] {
  return [...items].sort((left, right) => {
    const byName = nameCollator.compare(left.name, right.name);
    if (sort === "name-asc") return byName;
    if (sort === "name-desc") return -byName;
    if (sort === "suppliers-desc") {
      return right.supplierCount - left.supplierCount || byName;
    }
    if (sort === "lines-desc") {
      return right.linkedLineItemCount - left.linkedLineItemCount || byName;
    }
    if (sort === "uploaded-desc") {
      const leftTimestamp = left.lastUploadedAt ? Date.parse(left.lastUploadedAt) : null;
      const rightTimestamp = right.lastUploadedAt ? Date.parse(right.lastUploadedAt) : null;
      const leftDate = leftTimestamp !== null && Number.isFinite(leftTimestamp)
        ? leftTimestamp
        : null;
      const rightDate = rightTimestamp !== null && Number.isFinite(rightTimestamp)
        ? rightTimestamp
        : null;
      if (leftDate === null) return rightDate === null ? byName : 1;
      if (rightDate === null) return -1;
      return rightDate - leftDate || byName;
    }

    if (left.fairPrice === null) return right.fairPrice === null ? byName : 1;
    if (right.fairPrice === null) return -1;
    const priceDifference = left.fairPrice - right.fairPrice;
    return (sort === "price-asc" ? priceDifference : -priceDifference) || byName;
  });
}

export function CatalogBrowser({ onSelect }: { onSelect: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CatalogSortOption>("name-asc");
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [input]);

  const catalog = useQuery({
    queryKey: ["catalog", query],
    queryFn: () => api.catalog(query, 1, 50)
  });
  const sortedItems = useMemo(
    () => sortCatalogItems(catalog.data?.items ?? [], sort),
    [catalog.data?.items, sort]
  );

  async function handleDelete(event: React.MouseEvent, itemId: string, itemName: string) {
    event.stopPropagation();
    if (window.confirm(
      `Deactivate "${itemName}"? Historical price observations remain in the audit trail.`
    )) {
      try {
        await api.deleteCatalogItem(itemId);
        void queryClient.invalidateQueries({ queryKey: ["catalog"] });
        void queryClient.invalidateQueries({ queryKey: ["stats"] });
        void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
        void queryClient.invalidateQueries({ queryKey: ["unmatched-line-items"] });
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to delete service.");
      }
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
        <div className="heading-actions">
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
          <label className="catalog-select catalog-sort">
            <span>Sort</span>
            <select
              aria-label="Sort catalog services"
              value={sort}
              onChange={(event) => setSort(event.target.value as CatalogSortOption)}
            >
              {catalogSortOptions.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button
            className="button secondary"
            onClick={() => setShowCreateModal(true)}
            title="Add a new canonical catalog service"
          >
            + Add Service
          </button>
        </div>
      </div>

      {catalog.isLoading && <CatalogSkeleton />}
      {catalog.isError && <ErrorState message={catalog.error.message} />}
      {catalog.data?.items.length === 0 && (
        <div className="empty-state">
          <span>∅</span>
          <h3>No catalog services found</h3>
          <p>
            {query
              ? `Nothing matches “${query}”. Try a broader search.`
              : "Run ingestion and catalog matching to populate this view."}
          </p>
        </div>
      )}

      <div className="catalog-grid">
        {sortedItems.map((item) => (
          <article
            className="catalog-card"
            key={item.id}
          >
            <button
              type="button"
              className="card-open-button"
              aria-label={`View ${item.name}`}
              onClick={() => onSelect(item.id)}
            />
            <div className="card-topline">
              <span className="category-pill">{item.category}</span>
              <div className="card-topline-actions">
                <button
                  type="button"
                  className="delete-icon-btn"
                  title="Deactivate service"
                  aria-label={`Deactivate ${item.name}`}
                  onClick={(e) => handleDelete(e, item.id, item.name)}
                >
                  🗑
                </button>
                <span className="arrow">↗</span>
              </div>
            </div>
            <h3>{item.name}</h3>
            <p>{item.description ?? "Canonical service with linked supplier pricing."}</p>
            <small className="catalog-uploaded-date">
              {item.lastUploadedAt
                ? `Last uploaded ${formatDate(item.lastUploadedAt)}`
                : "No uploaded quote date"}
            </small>
            <div className="fair-price-row">
              <span>Fair price</span>
              <strong>{item.fairPrice === null ? "Insufficient data" : zar.format(item.fairPrice)}</strong>
              <small>per {item.primaryUnit}</small>
            </div>
            <dl className="card-metrics">
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
