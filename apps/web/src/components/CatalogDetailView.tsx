import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LinkedLineItem } from "@quote-intelligence/domain";
import { useState } from "react";
import { api } from "../api";
import { formatDate, zar } from "../format";
import { PriceHistoryChart } from "./PriceHistoryChart";
import { ReassignModal } from "./ReassignModal";

export function CatalogDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<LinkedLineItem | null>(null);
  const detail = useQuery({
    queryKey: ["catalog", id],
    queryFn: () => api.catalogDetail(id),
    enabled: Boolean(id)
  });
  const catalogOptions = useQuery({
    queryKey: ["catalog", "modal-options"],
    queryFn: () => api.catalog("", 1, 100)
  });

  if (detail.isLoading) return <div className="detail-loading">Loading price intelligence…</div>;
  if (detail.isError) {
    return (
      <div className="error-state">
        <strong>Unable to load this catalog item</strong>
        <p>{detail.error.message}</p>
        <button className="button secondary" onClick={onBack}>Back to catalog</button>
      </div>
    );
  }
  if (!detail.data) return null;
  const { item, fairPrice, priceHistory, supplierComparison, linkedLineItems } = detail.data;

  return (
    <section className="detail-view">
      <button className="back-button" onClick={onBack}>← Catalog</button>
      <header className="detail-header">
        <div>
          <div className="tag-row">
            <span className="category-pill">{item.category}</span>
            <span className="basis-pill">per {item.pricingBasis}</span>
          </div>
          <h2>{item.name}</h2>
          <p>{item.description ?? "Canonical service assembled from supplier quote lines."}</p>
        </div>
        <div className="fair-price-hero">
          <span>Estimated fair price</span>
          <strong>{fairPrice.value === null ? "—" : zar.format(fairPrice.value)}</strong>
          <small>ex VAT · per {item.pricingBasis}</small>
        </div>
      </header>

      <div className="explanation-grid">
        <article className="panel formula-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Transparent benchmark</p>
              <h3>How this price was calculated</h3>
            </div>
            <span className={`confidence confidence-${confidenceLabel(fairPrice.confidence).toLowerCase()}`}>
              {confidenceLabel(fairPrice.confidence)} confidence
            </span>
          </div>
          <p className="formula">{fairPrice.formula}</p>
          <div className="formula-values">
            <Metric label="Overall median" value={moneyOrDash(fairPrice.overallMedian)} />
            <Metric label="Recent median" value={moneyOrDash(fairPrice.recentMedian)} />
            <Metric label="Mean rate" value={moneyOrDash(fairPrice.mean)} />
            <Metric label="Observations" value={String(fairPrice.sampleSize)} />
            <Metric label="Suppliers" value={String(fairPrice.supplierCount)} />
          </div>
          <p className="exclusion-note">
            {fairPrice.excludedCount} non-comparable or invalid observation(s) excluded.
            {" "}{fairPrice.outlierCount} statistical outlier(s) highlighted but retained in the median.
          </p>
        </article>
        <article className="panel mini-observations">
          <p className="eyebrow">Evidence</p>
          <h3>Rates behind the benchmark</h3>
          <div className="observation-list">
            {fairPrice.observations.slice(-6).reverse().map((observation, index) => (
              <div key={`${observation.date}-${observation.supplierName}-${index}`}>
                <span className={observation.outlier ? "outlier-dot" : "normal-dot"} />
                <span>{observation.supplierName}<small>{formatDate(observation.date)}</small></span>
                <strong>{zar.format(observation.rate)}</strong>
              </div>
            ))}
          </div>
        </article>
      </div>

      <article className="panel chart-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Market movement</p>
            <h3>Price history by supplier</h3>
          </div>
          <span className="panel-note">Normalized ex-VAT rates</span>
        </div>
        <PriceHistoryChart points={priceHistory} />
      </article>

      <article className="panel table-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Supplier comparison</p>
            <h3>Who charges what?</h3>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Average rate</th>
                <th>Range</th>
                <th>vs fair price</th>
                <th>Quotes</th>
                <th>Last quote</th>
              </tr>
            </thead>
            <tbody>
              {supplierComparison.map((supplier) => {
                const variance =
                  fairPrice.value === null ? null : (supplier.averageRate / fairPrice.value - 1) * 100;
                return (
                  <tr key={supplier.supplierId}>
                    <td><strong>{supplier.supplierName}</strong><small>per {supplier.primaryUnit}</small></td>
                    <td>{zar.format(supplier.averageRate)}</td>
                    <td>{zar.format(supplier.minRate)} – {zar.format(supplier.maxRate)}</td>
                    <td><Variance value={variance} /></td>
                    <td>{supplier.quoteCount}</td>
                    <td>{formatDate(supplier.lastQuoteDate)}<small>{zar.format(supplier.lastQuotedRate)}</small></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel linked-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Match transparency</p>
            <h3>Linked supplier line items</h3>
          </div>
          <span className="panel-note">{linkedLineItems.length} mappings</span>
        </div>
        <div className="linked-list">
          {linkedLineItems.map((line) => (
            <div className="linked-row" key={line.id}>
              <div>
                <strong>{line.description}</strong>
                <span>{line.supplierName} · {line.quoteNumber} · {formatDate(line.date)}</span>
              </div>
              <div className="line-rate">
                <strong>{zar.format(line.rawRate)}</strong>
                <span>{line.rawUnit} · {line.taxBasis} VAT</span>
              </div>
              <div className="line-status">
                <span className={line.comparable ? "status-good" : "status-warn"}>
                  {line.comparable ? "Comparable" : "Review basis"}
                </span>
                {line.estimated && <small>Estimated conversion</small>}
              </div>
              <button className="button secondary compact" onClick={() => setEditing(line)}>
                Reassign
              </button>
            </div>
          ))}
        </div>
      </article>

      {editing && (
        <ReassignModal
          lineItem={editing}
          catalogItems={(catalogOptions.data?.items ?? []).filter(({ id: optionId }) => optionId !== id)}
          catalogOptionsError={catalogOptions.isError ? catalogOptions.error.message : undefined}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ["catalog"] });
            void queryClient.invalidateQueries({ queryKey: ["catalog", id] });
            void queryClient.invalidateQueries({ queryKey: ["stats"] });
            void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
            void queryClient.invalidateQueries({ queryKey: ["unmatched-line-items"] });
          }}
        />
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function moneyOrDash(value: number | null) {
  return value === null ? "—" : zar.format(value);
}

function confidenceLabel(value: number) {
  if (value >= 0.75) return "High";
  if (value >= 0.4) return "Medium";
  return "Low";
}

function Variance({ value }: { value: number | null }) {
  if (value === null) return <span>—</span>;
  const className = Math.abs(value) <= 5 ? "variance-neutral" : value > 0 ? "variance-high" : "variance-low";
  return <span className={className}>{value > 0 ? "+" : ""}{value.toFixed(1)}%</span>;
}
