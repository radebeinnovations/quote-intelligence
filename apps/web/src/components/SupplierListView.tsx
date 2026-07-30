import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import {
  resolveDateRange,
  type DateRangePreset
} from "../date-range";
import { formatDate, formatNumber, zar } from "../format";
import { DateRangeSelector } from "./DateRangeSelector";

export function SupplierListView() {
  const [dateRangePreset, setDateRangePreset] =
    useState<DateRangePreset>("all-time");
  const suppliers = useQuery({
    queryKey: ["suppliers", dateRangePreset],
    queryFn: () => api.suppliers(resolveDateRange(dateRangePreset))
  });

  return (
    <section className="catalog-view suppliers-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Supplier Analytics</p>
          <h2>Vendor Pricing Performance</h2>
          <p>
            Evaluate supplier quote history, line volume, and pricing variance against
            canonical market fair-prices.
          </p>
        </div>
        <DateRangeSelector
          className="supplier-date-filter"
          value={dateRangePreset}
          onChange={setDateRangePreset}
        />
      </div>

      {suppliers.isLoading && <div className="detail-loading">Loading supplier analytics…</div>}
      {suppliers.isError && (
        <div className="error-state">
          <strong>Unable to load supplier performance</strong>
          <p>{suppliers.error.message}</p>
        </div>
      )}

      {suppliers.data && (
        <div className="catalog-grid">
          {suppliers.data.map((s) => {
            const varianceClass =
              s.variancePercent === null
                ? "variance-neutral"
                : s.variancePercent > 3
                ? "variance-high"
                : s.variancePercent < -3
                ? "variance-low"
                : "variance-neutral";

            const varianceText =
              s.variancePercent === null
                ? "Insufficient data"
                : s.variancePercent > 0
                ? `+${s.variancePercent.toFixed(1)}% vs Market`
                : `${s.variancePercent.toFixed(1)}% vs Market`;

            return (
              <div className="catalog-card supplier-card" key={s.supplierId}>
                <div className="card-topline">
                  <span className={`variance-tag ${varianceClass}`}>{varianceText}</span>
                  <span className="arrow">↗</span>
                </div>
                <h3>{s.supplierName}</h3>
                <p>
                  {s.email || s.phone
                    ? [s.email, s.phone].filter(Boolean).join(" · ")
                    : "South African event procurement vendor."}
                </p>
                <div className="fair-price-row">
                  <span>Average ex-VAT Rate</span>
                  <strong>{s.averageRate ? zar.format(s.averageRate) : "—"}</strong>
                  <small>
                    Active quotes: {s.firstQuoteDate ? `${formatDate(s.firstQuoteDate)} – ${formatDate(s.lastQuoteDate!)}` : "None"}
                  </small>
                </div>
                <dl className="card-metrics">
                  <div>
                    <dt>Quotes</dt>
                    <dd>{formatNumber(s.quoteCount)}</dd>
                  </div>
                  <div>
                    <dt>Extracted Lines</dt>
                    <dd>{formatNumber(s.lineItemCount)}</dd>
                  </div>
                  <div>
                    <dt>Market Standing</dt>
                    <dd>
                      {s.variancePercent === null
                        ? "Pending"
                        : s.variancePercent > 3
                        ? "Premium"
                        : s.variancePercent < -3
                        ? "Competitive"
                        : "Market Rate"}
                    </dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
