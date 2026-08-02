import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import {
  resolveDateRange,
  type DateRangePreset
} from "../date-range";
import { formatDate, formatNumber, zar } from "../format";
import { DateRangeSelector } from "./DateRangeSelector";
import { CreateSupplierModal } from "./CreateSupplierModal";

export function SupplierListView({ onSelect }: { onSelect: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [dateRangePreset, setDateRangePreset] =
    useState<DateRangePreset>("all-time");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const suppliers = useQuery({
    queryKey: ["suppliers", dateRangePreset],
    queryFn: () => api.suppliers(resolveDateRange(dateRangePreset))
  });

  async function deactivateSupplier(id: string, name: string) {
    if (!window.confirm(`Deactivate "${name}"? Quote history remains auditable.`)) return;
    try {
      await api.deleteSupplier(id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
        queryClient.invalidateQueries({ queryKey: ["stats"] })
      ]);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to deactivate supplier.");
    }
  }

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
        <div className="page-actions">
          <DateRangeSelector
            className="supplier-date-filter"
            value={dateRangePreset}
            onChange={setDateRangePreset}
          />
          <button className="button secondary compact" onClick={() => setShowCreateModal(true)}>
            + Add supplier
          </button>
        </div>
      </div>

      {suppliers.isLoading && <div className="detail-loading">Loading supplier analytics…</div>}
      {suppliers.isError && (
        <div className="error-state">
          <strong>Unable to load supplier performance</strong>
          <p>{suppliers.error.message}</p>
        </div>
      )}

      {suppliers.data && (
        suppliers.data.length === 0 ? (
          <div className="empty-state">
            <span>∅</span>
            <h3>No suppliers in this range</h3>
            <p>Upload supplier quotes or choose a wider date range.</p>
          </div>
        ) : (
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
              <article
                className="catalog-card supplier-card"
                key={s.supplierId}
              >
                <button
                  type="button"
                  className="catalog-card-hitbox"
                  aria-label={`Open ${s.supplierName} supplier profile`}
                  onClick={() => onSelect(s.supplierId)}
                />
                <div className="card-topline">
                  <span className={`variance-tag ${varianceClass}`}>{varianceText}</span>
                  <div className="card-topline-actions catalog-card-content">
                    <button
                      type="button"
                      className="delete-icon-btn"
                      aria-label={`Deactivate ${s.supplierName}`}
                      onClick={() => void deactivateSupplier(s.supplierId, s.supplierName)}
                    >×</button>
                    <span className="arrow">↗</span>
                  </div>
                </div>
                <h3>{s.supplierName}</h3>
                <p>
                  {s.email || s.phone
                    ? [s.email, s.phone].filter(Boolean).join(" · ")
                    : "South African event procurement vendor."}
                </p>
                <div className="fair-price-row">
                  <span>Total quoted spend</span>
                  <strong>{zar.format(s.totalSpend)}</strong>
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
                    <dt>Competitiveness</dt>
                    <dd>
                      {s.competitivenessIndex === null
                        ? "Pending"
                        : s.competitivenessIndex.toFixed(1)}
                    </dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
        )
      )}
      {showCreateModal && (
        <CreateSupplierModal
          onClose={() => setShowCreateModal(false)}
          onSaved={() => {
            setShowCreateModal(false);
            void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
            void queryClient.invalidateQueries({ queryKey: ["stats"] });
          }}
        />
      )}
    </section>
  );
}
