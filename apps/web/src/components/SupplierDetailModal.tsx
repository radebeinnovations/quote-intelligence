import type { SupplierAnalytics } from "@quote-intelligence/domain";
import { formatDate, formatNumber, zar } from "../format";

interface SupplierDetailModalProps {
  supplier: SupplierAnalytics;
  onClose: () => void;
  onDelete: (id: string, name: string) => void;
}

export function SupplierDetailModal({
  supplier,
  onClose,
  onDelete
}: SupplierDetailModalProps) {
  const varianceClass =
    supplier.variancePercent === null
      ? "variance-neutral"
      : supplier.variancePercent > 3
      ? "variance-high"
      : supplier.variancePercent < -3
      ? "variance-low"
      : "variance-neutral";

  const varianceText =
    supplier.variancePercent === null
      ? "Insufficient market data"
      : supplier.variancePercent > 0
      ? `+${supplier.variancePercent.toFixed(1)}% vs Market Benchmark`
      : `${supplier.variancePercent.toFixed(1)}% vs Market Benchmark`;

  const marketStanding =
    supplier.variancePercent === null
      ? "Pending Data"
      : supplier.variancePercent > 3
      ? "Premium Pricing"
      : supplier.variancePercent < -3
      ? "Competitive Rates"
      : "Market Benchmark Rate";

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal supplier-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="supplier-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="doc-preview-header">
          <span className={`variance-tag ${varianceClass}`}>{varianceText}</span>
          <span className="category-pill">{marketStanding}</span>
        </div>

        <h2 id="supplier-modal-title">{supplier.supplierName}</h2>
        <p className="doc-subtitle">
          {supplier.email || supplier.phone
            ? [supplier.email, supplier.phone].filter(Boolean).join(" · ")
            : "South African event & procurement vendor"}
        </p>

        <div className="fair-price-hero" style={{ marginBottom: "20px" }}>
          <span>Average Ex-VAT Quoted Rate</span>
          <strong>{supplier.averageRate ? zar.format(supplier.averageRate) : "—"}</strong>
          <small>
            Active quotes on file:{" "}
            {supplier.firstQuoteDate
              ? `${formatDate(supplier.firstQuoteDate)} – ${formatDate(supplier.lastQuoteDate!)}`
              : "No quotes recorded"}
          </small>
        </div>

        <div className="doc-meta-grid">
          <div>
            <span>Total Quotes</span>
            <strong>{formatNumber(supplier.quoteCount)}</strong>
          </div>
          <div>
            <span>Extracted Line Items</span>
            <strong>{formatNumber(supplier.lineItemCount)}</strong>
          </div>
          <div>
            <span>Market Standing</span>
            <strong>{marketStanding}</strong>
          </div>
        </div>

        <div className="doc-section">
          <h3>Vendor Overview &amp; Analytics</h3>
          <div className="pdf-page-mock">
            <div className="pdf-page-header">
              <strong>{supplier.supplierName} Performance Record</strong>
              <span>Normalized ex-VAT Basis</span>
            </div>
            <div className="pdf-page-body">
              <p>
                <strong>Email:</strong> {supplier.email || "Not specified"}
              </p>
              <p>
                <strong>Phone:</strong> {supplier.phone || "Not specified"}
              </p>
              <p>
                <strong>Pricing Standing:</strong> {varianceText}
              </p>
              <div className="pdf-extracted-lines" style={{ marginTop: "14px" }}>
                <small>Audit Summary:</small>
                <div className="line-clean-row">
                  • Verified across {formatNumber(supplier.quoteCount)} quote documents ({formatNumber(supplier.lineItemCount)} lines extracted).
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-actions" style={{ justifyContent: "space-between" }}>
          <button
            type="button"
            className="button secondary"
            style={{ color: "#ef7b76", borderColor: "rgba(239, 123, 118, 0.3)" }}
            onClick={() => {
              onClose();
              onDelete(supplier.supplierId, supplier.supplierName);
            }}
          >
            🗑 Delete Vendor
          </button>
          <button type="button" className="button primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
