import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LinkedLineItem } from "@quote-intelligence/domain";
import { useState } from "react";
import { api } from "../api";
import { formatDate, zar } from "../format";
import { Price } from "./Price";
import { PriceHistoryChart } from "./PriceHistoryChart";
import { ReassignModal } from "./ReassignModal";
import { downloadCsv } from "../csv";

export function CatalogDetailView({
  id,
  initialVariantIds = [],
  onBack
}: {
  id: string;
  initialVariantIds?: string[];
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<LinkedLineItem | null>(null);
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>(initialVariantIds);
  const detail = useQuery({
    queryKey: ["catalog", id, { variantIds: selectedVariantIds }],
    queryFn: () => api.catalogDetail(id, selectedVariantIds),
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

  function exportLinkedLinesCsv() {
    const header = [
      "Supplier Description",
      "Supplier Name",
      "Quote Number",
      "Quote Date",
      "Raw Quantity",
      "Raw Unit",
      "Raw Rate (ZAR)",
      "Tax Basis",
      "Normalized Rate Ex-VAT (ZAR)",
      "Normalized Unit",
      "Comparable",
      "Estimated Conversion"
    ];
    const rows = linkedLineItems.map((line) => [
      line.description,
      line.supplierName,
      line.quoteNumber,
      line.date,
      line.quantity,
      line.rawUnit,
      line.rawRate,
      line.taxBasis,
      line.normalizedRate ?? "",
      line.normalizedUnit ?? "",
      line.comparable ? "Yes" : "No",
      line.estimated ? "Yes" : "No"
    ]);
    downloadCsv(`${item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-line-items.csv`, [
      header,
      ...rows
    ]);
  }

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
          <strong>{fairPrice.value === null ? "—" : <Price amount={fairPrice.value} label={`${item.name} Fair Price`} />}</strong>
          <small>ex VAT · per {item.pricingBasis}</small>
        </div>
      </header>

      {item.variants.length > 0 && (
        <div className="variant-filter-panel panel">
          <div>
            <p className="eyebrow">Comparable variants</p>
            <h3>Filter the benchmark</h3>
            <p>
              Select one or more variants to recalculate every metric and overlay
              their supplier histories. Clear the filter for the consolidated view.
            </p>
          </div>
          <div className="variant-filter-strip" aria-label="Filter analytics by variant">
            <button
              type="button"
              className={selectedVariantIds.length === 0 ? "active" : ""}
              aria-pressed={selectedVariantIds.length === 0}
              onClick={() => setSelectedVariantIds([])}
            >
              All Sizes / Global Average
            </button>
            {item.variants.map((variant) => {
              const active = selectedVariantIds.includes(variant.id);
              return (
                <button
                  type="button"
                  className={active ? "active" : ""}
                  aria-pressed={active}
                  key={variant.id}
                  onClick={() =>
                    setSelectedVariantIds((current) =>
                      active
                        ? current.filter((variantId) => variantId !== variant.id)
                        : [...current, variant.id]
                    )
                  }
                >
                  {variant.label}
                  <small>per {variant.pricingBasis}</small>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
            <Metric label="Overall median" value={moneyOrDash(fairPrice.overallMedian, "Overall Median")} />
            <Metric label="Recent median" value={moneyOrDash(fairPrice.recentMedian, "Recent Median")} />
            <Metric label="Mean rate" value={moneyOrDash(fairPrice.mean, "Mean Rate")} />
            <Metric label="IQR-filtered mean" value={moneyOrDash(fairPrice.filteredMean, "IQR-filtered Mean")} />
            <Metric label="Observations" value={String(fairPrice.sampleSize)} />
            <Metric label="Suppliers" value={String(fairPrice.supplierCount)} />
          </div>
          <p className="exclusion-note">
            {fairPrice.excludedCount} non-comparable or invalid observation(s) excluded.
            {" "}{fairPrice.outlierCount} statistical outlier(s) highlighted but retained in the median.
            {fairPrice.iqrLow !== null && fairPrice.iqrHigh !== null && (
              <> IQR fence: <Price amount={fairPrice.iqrLow} label="IQR Low" />–<Price amount={fairPrice.iqrHigh} label="IQR High" />.</>
            )}
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
                <strong><Price amount={observation.rate} label={`${observation.supplierName} Observation`} /></strong>
              </div>
            ))}
          </div>
        </article>
      </div>

      <article className="panel chart-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Market movement</p>
            <h3>Price history by supplier &amp; variant</h3>
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
                    <td><Price amount={supplier.averageRate} label={`${supplier.supplierName} Avg Rate`} /></td>
                    <td><Price amount={supplier.minRate} label={`${supplier.supplierName} Min Rate`} /> – <Price amount={supplier.maxRate} label={`${supplier.supplierName} Max Rate`} /></td>
                    <td><Variance value={variance} /></td>
                    <td>{supplier.quoteCount}</td>
                    <td>{formatDate(supplier.lastQuoteDate)}<small><Price amount={supplier.lastQuotedRate} label={`${supplier.supplierName} Last Rate`} /></small></td>
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
          <div className="panel-actions">
            <span className="panel-note">{linkedLineItems.length} mappings</span>
            <button
              className="button secondary compact"
              onClick={exportLinkedLinesCsv}
              disabled={!linkedLineItems.length}
            >
              ↓ Export CSV
            </button>
          </div>
        </div>
        <div className="linked-list">
          {linkedLineItems.map((line) => (
            <div className="linked-row" key={line.id}>
              <div>
                <strong>{line.description}</strong>
                <span>{line.supplierName} · {line.quoteNumber} · {formatDate(line.date)}</span>
              </div>
              <div className="line-rate">
                <strong><Price amount={line.rawRate} label={`${line.supplierName} Raw Rate`} /></strong>
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
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ["catalog"] });
            void queryClient.invalidateQueries({
              predicate: ({ queryKey }) =>
                queryKey[0] === "catalog" && queryKey[1] === id
            });
          }}
        />
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function moneyOrDash(value: number | null, label: string) {
  return value === null ? "—" : <Price amount={value} label={label} />;
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
