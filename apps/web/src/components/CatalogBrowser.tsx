import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type CatalogCategory,
  type CatalogSortBy,
  type SortOrder
} from "@quote-intelligence/domain";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { downloadCsv } from "../csv";
import { resolveDateRange, type DateRangePreset } from "../date-range";
import { formatDate, formatNumber, zar } from "../format";
import { Price } from "./Price";
import { CreateCatalogItemModal } from "./CreateCatalogItemModal";
import { DateRangeSelector } from "./DateRangeSelector";

const sortOptions: Array<{
  value: `${CatalogSortBy}:${SortOrder}`;
  label: string;
}> = [
  { value: "name:asc", label: "Name: A-Z" },
  { value: "name:desc", label: "Name: Z-A" },
  { value: "fairPrice:asc", label: "Fair price: Low-High" },
  { value: "fairPrice:desc", label: "Fair price: High-Low" },
  { value: "supplierCount:desc", label: "Suppliers: Most-Least" },
  { value: "supplierCount:asc", label: "Suppliers: Least-Most" }
];

function categoryLabel(category: CatalogCategory): string {
  return category === "Equipment hire" ? "Equipment Hire" : category;
}

export function CatalogBrowser({
  onSelect,
  onUpload = () => undefined,
  onRefresh,
  hasExtractedLines = false
}: {
  onSelect: (id: string, variantIds?: string[]) => void;
  onUpload?: () => void;
  onRefresh?: () => Promise<void>;
  hasExtractedLines?: boolean;
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [normalizationRetrying, setNormalizationRetrying] = useState(false);
  const [normalizationError, setNormalizationError] = useState<string | null>(null);
  const [selectedVariantLabel, setSelectedVariantLabel] = useState<string>("");
  const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [input]);

  const { data: dynamicCategories = [] } = useQuery({
    queryKey: ["catalog-categories"],
    queryFn: api.getCategories,
    staleTime: 60000,
  });

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

  const availableVariantLabels = useMemo(() => {
    if (!catalog.data?.items) return [];
    const labels = new Set<string>();
    for (const item of catalog.data.items) {
      for (const variant of item.variants) {
        if (variant.label) labels.add(variant.label);
      }
    }
    return Array.from(labels).sort();
  }, [catalog.data?.items]);

  const displayedItems = useMemo(() => {
    if (!catalog.data?.items) return [];
    if (!selectedVariantLabel) return catalog.data.items;
    return catalog.data.items.filter(item => 
      item.variants.some(v => v.label === selectedVariantLabel)
    );
  }, [catalog.data?.items, selectedVariantLabel]);

  function exportCsv() {
    if (!displayedItems.length) return;
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
    const rows = displayedItems.map((item) => [
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

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      if (onRefresh) {
        await onRefresh();
      } else {
        await queryClient.invalidateQueries();
        await queryClient.refetchQueries({ queryKey: ["catalog"] });
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  async function confirmDelete() {
    if (!itemToDelete) return;
    try {
      await api.deleteCatalogItem(itemToDelete.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["stats"] }),
        queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
        queryClient.invalidateQueries({ queryKey: ["unmatched-line-items"] })
      ]);
      setItemToDelete(null);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Failed to deactivate service."
      );
    }
  }

  async function retryCatalogNormalization() {
    setNormalizationRetrying(true);
    setNormalizationError(null);
    try {
      const result = await api.retryCatalogNormalization();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["stats"] }),
        queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
        queryClient.invalidateQueries({ queryKey: ["unmatched-line-items"] }),
        queryClient.invalidateQueries({ queryKey: ["ingestion-audit"] })
      ]);
      if (result.documentsFailed > 0) {
        setNormalizationError(
          `${result.documentsFailed} document${
            result.documentsFailed === 1 ? "" : "s"
          } still require attention. See Ingestion Audit for details.`
        );
      }
    } catch (error) {
      setNormalizationError(
        error instanceof Error
          ? error.message
          : "Catalog normalization could not be retried."
      );
    } finally {
      setNormalizationRetrying(false);
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
          <button
            className="button secondary compact"
            onClick={() => setShowCreateModal(true)}
          >
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
              {dynamicCategories.map((item) => (
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
              aria-label="Sort"
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
        {dynamicCategories.map((item) => (
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

      {availableVariantLabels.length > 0 && (
        <div className="category-filter-strip variant-filter-strip" aria-label="Filter catalog by size or variant">
          <button
            type="button"
            className={selectedVariantLabel === "" ? "active" : ""}
            aria-pressed={selectedVariantLabel === ""}
            onClick={() => setSelectedVariantLabel("")}
          >
            All Sizes
          </button>
          {availableVariantLabels.map((label) => (
            <button
              type="button"
              key={label}
              className={selectedVariantLabel === label ? "active" : ""}
              aria-pressed={selectedVariantLabel === label}
              onClick={() => setSelectedVariantLabel(label)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {catalog.isLoading && <CatalogSkeleton />}
      {catalog.isError && <ErrorState message={catalog.error.message} />}
      {displayedItems.length === 0 &&
        (query || category || selectedVariantLabel || dateRangePreset !== "all-time" ? (
          <div className="empty-state">
            <span>∅</span>
            <h3>No catalog services found</h3>
            <p>Nothing matches the current search, category, size, and date filters.</p>
          </div>
        ) : (
          <div className="bootstrap-callout panel">
            <span className="bootstrap-icon" aria-hidden="true">✦</span>
            <div>
              <p className="eyebrow">
                {hasExtractedLines ? "Normalization pending" : "Empty workspace"}
              </p>
              <h3>
                {hasExtractedLines
                  ? "Finish building your catalog"
                  : "Bootstrap your catalog"}
              </h3>
              <p>
                {hasExtractedLines
                  ? "Your quote lines are safely stored. Retry catalog normalization to create comparable services."
                  : "Drop a batch of supplier PDF/XLSX quotes. DocuPipe extracts the raw lines and normalization creates deduplicated base profiles with filterable variants."}
              </p>
              {normalizationError && (
                <p className="field-error" role="alert">{normalizationError}</p>
              )}
            </div>
            <button
              className="button primary"
              onClick={
                hasExtractedLines
                  ? () => void retryCatalogNormalization()
                  : onUpload
              }
              disabled={normalizationRetrying}
            >
              {hasExtractedLines
                ? normalizationRetrying
                  ? "Normalizing..."
                  : "Retry catalog normalization"
                : "Upload your first quotes"}
            </button>
          </div>
        ))}

      <div className="catalog-grid">
        {displayedItems.map((item) => (
          <article className="catalog-card" key={item.id}>
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
                  aria-label="Deactivate service"
                  onClick={(e) => {
                    e.stopPropagation();
                    setItemToDelete({ id: item.id, name: item.name });
                  }}
                >
                  Delete
                </button>
                <span className="arrow">↗</span>
              </div>
            </div>
            <h3 className="catalog-card-content">{item.name}</h3>
            <p className="catalog-card-content">
              {item.description ??
                "Canonical service with linked supplier pricing."}
            </p>
            <small className="catalog-uploaded-date catalog-card-content">
              {item.lastUploadedAt
                ? `Last uploaded ${formatDate(item.lastUploadedAt)}`
                : "No uploaded quote date"}
            </small>
            {item.variants.length > 0 && (
              <div
                className="variant-preview catalog-card-content"
                aria-label={`${item.name} variants`}
              >
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
                  <span className="variant-pill">
                    +{item.variants.length - 4}
                  </span>
                )}
              </div>
            )}
            <div className="fair-price-row catalog-card-content">
              <span>Fair price</span>
              <strong>
                {item.fairPrice === null
                  ? "Insufficient data"
                  : <Price amount={item.fairPrice} label={item.name} />}
              </strong>
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
                  {item.minPrice === null || item.maxPrice === null ? (
                    "—"
                  ) : (
                    <>
                      <Price amount={item.minPrice} label={`${item.name} (Min)`} /> –{" "}
                      <Price amount={item.maxPrice} label={`${item.name} (Max)`} />
                    </>
                  )}
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
          onSaved={async () => {
            setShowCreateModal(false);
            await queryClient.invalidateQueries();
            await queryClient.refetchQueries({ queryKey: ["catalog"] });
          }}
        />
      )}

      {itemToDelete && (
        <div className="modal-backdrop" onClick={() => setItemToDelete(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h2>Are you sure?</h2>
            <p style={{ color: 'var(--muted)', marginTop: 12, lineHeight: 1.6 }}>
              Do you really want to deactivate <strong>"{itemToDelete.name}"</strong>? 
              <br/><br/>
              Historical price observations will remain in the audit trail, but this item will no longer appear in the active catalog.
            </p>
            <div className="modal-actions" style={{ marginTop: 32 }}>
              <button 
                className="button secondary" 
                onClick={() => setItemToDelete(null)}
              >
                No, cancel
              </button>
              <button 
                className="button primary" 
                style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                onClick={confirmDelete}
              >
                Yes, delete
              </button>
            </div>
          </div>
        </div>
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
