import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { formatDate, formatNumber, zar } from "../format";
import { Price } from "./Price";

export function SupplierProfileView({
  id,
  onBack
}: {
  id: string;
  onBack: () => void;
}) {
  const profile = useQuery({
    queryKey: ["supplier", id],
    queryFn: () => api.supplierProfile(id),
    enabled: Boolean(id)
  });

  if (profile.isLoading) {
    return <div className="detail-loading">Loading supplier vault…</div>;
  }
  if (profile.isError) {
    return (
      <div className="error-state">
        <strong>Unable to load this supplier</strong>
        <p>{profile.error.message}</p>
        <button className="button secondary" onClick={onBack}>Back to suppliers</button>
      </div>
    );
  }
  if (!profile.data) return null;

  const { supplier, quoteCount, totalSpend, competitivenessIndex, quotes } =
    profile.data;

  return (
    <section className="supplier-profile">
      <button className="back-button" onClick={onBack}>← Suppliers</button>
      <header className="detail-header supplier-profile-header">
        <div>
          <div className="tag-row">
            <span className="category-pill">Supplier vault</span>
            {supplier.vatNumber && <span className="basis-pill">VAT {supplier.vatNumber}</span>}
          </div>
          <h2>{supplier.name}</h2>
          <p>
            {[supplier.email, supplier.phone, supplier.address]
              .filter(Boolean)
              .join(" · ") || "No supplier contact details were extracted."}
          </p>
        </div>
      </header>

      <div className="supplier-profile-metrics">
        <article className="panel">
          <span>Total quotes</span>
          <strong>{formatNumber(quoteCount)}</strong>
          <small>Including retained revisions</small>
        </article>
        <article className="panel">
          <span>Total quoted spend</span>
          <strong><Price amount={totalSpend} label={`${supplier.name} Total Spend`} /></strong>
          <small>Current extracted line totals · ex VAT</small>
        </article>
        <article className="panel">
          <span>Price competitiveness</span>
          <strong>
            {competitivenessIndex === null
              ? "Pending"
              : `${competitivenessIndex.toFixed(1)}`}
          </strong>
          <small>100 = market benchmark; higher is more competitive</small>
        </article>
      </div>

      <article className="panel supplier-vault-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Digital line record</p>
            <h3>Original quotes &amp; extracted lines</h3>
          </div>
          <span className="panel-note">{quotes.length} source records</span>
        </div>

        {quotes.length === 0 ? (
          <div className="chart-empty">No quotes are linked to this supplier yet.</div>
        ) : (
          <div className="quote-vault-list">
            {quotes.map((quote) => (
              <details className="quote-vault-entry" key={quote.id}>
                <summary>
                  <span>
                    <strong>{quote.quoteNumber}</strong>
                    <small>
                      {formatDate(quote.quoteDate)}
                      {quote.eventName ? ` · ${quote.eventName}` : ""}
                    </small>
                  </span>
                  <span className="quote-vault-total">
                    <strong>
                      {quote.totalExVat === null ? "—" : <Price amount={quote.totalExVat} label={`Quote ${quote.quoteNumber} Total`} />}
                    </strong>
                    <small>{quote.originalFilename}</small>
                  </span>
                </summary>
                <div className="quote-vault-content">
                  <div className="quote-vault-actions">
                    <span>Raw wording remains unchanged beside its normalized match.</span>
                    {quote.downloadUrl && (
                      <a
                        className="button secondary compact"
                        href={quote.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open original file ↗
                      </a>
                    )}
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Source row</th>
                          <th>Exact extracted line</th>
                          <th>Raw price</th>
                          <th>Canonical match</th>
                          <th>Normalized ex-VAT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quote.lines.map((line) => (
                          <tr key={line.id}>
                            <td>{line.sourceRow ?? "—"}</td>
                            <td>
                              <strong>{line.rawDescription}</strong>
                              <small>Qty {line.quantity} · {line.rawUnit}</small>
                            </td>
                            <td>
                              <Price amount={line.rawRate} label={`${line.rawDescription} (Raw Rate)`} />
                              <small>Total <Price amount={line.rawTotal} label={`${line.rawDescription} (Raw Total)`} /></small>
                            </td>
                            <td>
                              {line.catalogItemName ?? "Unmatched"}
                              {line.variantLabel && <small>{line.variantLabel}</small>}
                            </td>
                            <td>
                              {line.normalizedRate === null
                                ? "Not comparable"
                                : <Price amount={line.normalizedRate} label={`${line.rawDescription} (Normalized Rate)`} />}
                              {line.normalizedBasis && <small>per {line.normalizedBasis}</small>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
