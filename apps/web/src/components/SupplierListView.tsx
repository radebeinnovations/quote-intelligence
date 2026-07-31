import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupplierAnalytics } from "@quote-intelligence/domain";
import { useState } from "react";
import { api } from "../api";
import {
  resolveDateRange,
  type DateRangePreset
} from "../date-range";
import { formatDate, formatNumber, zar } from "../format";
import { CreateSupplierModal } from "./CreateSupplierModal";
import { DateRangeSelector } from "./DateRangeSelector";
import { SupplierDetailModal } from "./SupplierDetailModal";

export function SupplierListView() {
  const queryClient = useQueryClient();
  const [dateRangePreset, setDateRangePreset] =
    useState<DateRangePreset>("all-time");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierAnalytics | null>(null);

  const suppliers = useQuery({
    queryKey: ["suppliers", dateRangePreset],
    queryFn: () => api.suppliers(resolveDateRange(dateRangePreset))
  });

  async function handleDeleteSupplier(supplierId: string, supplierName: string) {
    if (window.confirm(
      `Deactivate vendor "${supplierName}"? Historical quotes remain in the audit trail.`
    )) {
      try {
        await api.deleteSupplier(supplierId);
        void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
        void queryClient.invalidateQueries({ queryKey: ["stats"] });
        void queryClient.invalidateQueries({ queryKey: ["catalog"] });
        void queryClient.invalidateQueries({ queryKey: ["unmatched-line-items"] });
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to delete supplier.");
      }
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
            canonical market fair-prices. Click any supplier card to inspect analytics.
          </p>
        </div>
        <div className="heading-actions">
          <DateRangeSelector
            className="supplier-date-filter"
            value={dateRangePreset}
            onChange={setDateRangePreset}
          />
          <button
            className="button secondary"
            onClick={() => setShowCreateModal(true)}
            title="Register a new supplier"
          >
            + Add Supplier
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
                  className="card-open-button"
                  aria-label={`View analytics for ${s.supplierName}`}
                  onClick={() => setSelectedSupplier(s)}
                />
                <div className="card-topline">
                  <span className={`variance-tag ${varianceClass}`}>{varianceText}</span>
                  <div className="card-topline-actions">
                    <button
                      type="button"
                      className="delete-icon-btn"
                      title="Deactivate supplier"
                      aria-label={`Deactivate ${s.supplierName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSupplier(s.supplierId, s.supplierName);
                      }}
                    >
                      🗑
                    </button>
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
                  <span>Average ex-VAT Rate</span>
                  <strong>{s.averageRate !== null ? zar.format(s.averageRate) : "—"}</strong>
                  <small>
                    Active quotes: {s.firstQuoteDate && s.lastQuoteDate ? `${formatDate(s.firstQuoteDate)} – ${formatDate(s.lastQuoteDate)}` : "None"}
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
              </article>
            );
          })}
        </div>
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

      {selectedSupplier && (
        <SupplierDetailModal
          supplier={selectedSupplier}
          onClose={() => setSelectedSupplier(null)}
          onDelete={(id, name) => handleDeleteSupplier(id, name)}
        />
      )}
    </section>
  );
}
