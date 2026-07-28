import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api";
import { formatNumber, zar } from "../format";

export function CatalogBrowser({ onSelect }: { onSelect: (id: string) => void }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [input]);

  const catalog = useQuery({
    queryKey: ["catalog", query],
    queryFn: () => api.catalog(query, 1, 50)
  });

  return (
    <section className="catalog-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Procurement catalog</p>
          <h2>Comparable services, one clear view.</h2>
          <p>Every price below is normalized to an ex-VAT comparison basis.</p>
        </div>
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
        {catalog.data?.items.map((item) => (
          <button
            className="catalog-card"
            key={item.id}
            onClick={() => onSelect(item.id)}
          >
            <div className="card-topline">
              <span className="category-pill">{item.category}</span>
              <span className="arrow">↗</span>
            </div>
            <h3>{item.name}</h3>
            <p>{item.description ?? "Canonical service with linked supplier pricing."}</p>
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
          </button>
        ))}
      </div>
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
