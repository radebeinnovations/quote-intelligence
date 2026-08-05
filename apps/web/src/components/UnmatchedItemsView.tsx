import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UnmatchedLineItem } from "@quote-intelligence/domain";
import { useState } from "react";
import { api } from "../api";
import { formatDate, zar } from "../format";
import { ReassignModal } from "./ReassignModal";

export function UnmatchedItemsView() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<UnmatchedLineItem | null>(null);
  const unmatched = useQuery({
    queryKey: ["unmatched-line-items"],
    queryFn: api.unmatchedLineItems
  });
  const catalogOptions = useQuery({
    queryKey: ["catalog", "review-options"],
    queryFn: () => api.catalog("", 1, 100)
  });

  return (
    <section className="catalog-view review-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Matching review</p>
          <h2>Unmatched supplier lines.</h2>
          <p>
            Assign cautious non-matches to an existing service or split them into a
            new canonical catalog entry.
          </p>
        </div>
        {unmatched.data && (
          <div className="review-count" aria-label={`${unmatched.data.total} unmatched lines`}>
            <strong>{unmatched.data.total}</strong>
            <span>awaiting review</span>
          </div>
        )}
      </div>

      {unmatched.isLoading && <div className="detail-loading">Loading review queue…</div>}
      {unmatched.isError && (
        <div className="error-state">
          <strong>Unable to load unmatched lines</strong>
          <p>{unmatched.error.message}</p>
        </div>
      )}
      {unmatched.data?.items.length === 0 && (
        <div className="empty-state">
          <span>✓</span>
          <h3>Everything is matched</h3>
          <p>No supplier lines currently require catalog assignment.</p>
        </div>
      )}

      {unmatched.data && unmatched.data.items.length > 0 && (
        <article className="panel linked-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Conservative non-matches</p>
              <h3>Supplier lines requiring a decision</h3>
            </div>
            <span className="panel-note">{unmatched.data.total} lines</span>
          </div>
          <div className="linked-list">
            {unmatched.data.items.map((line) => (
              <div className="linked-row" key={line.id}>
                <div>
                  <strong>{line.description}</strong>
                  <span>
                    {line.supplierName} · {line.quoteNumber} · {formatDate(line.date)}
                  </span>
                </div>
                <div className="line-rate">
                  <strong>{zar.format(line.rawRate)}</strong>
                  <span>
                    {line.quantity} × {line.rawUnit} · {line.taxBasis} VAT
                  </span>
                </div>
                <div className="line-status">
                  <span className="status-warn">Unmatched</span>
                  <small>No conservative rule</small>
                </div>
                <button
                  className="button secondary compact"
                  onClick={() => setEditing(line)}
                >
                  Assign
                </button>
              </div>
            ))}
          </div>
        </article>
      )}

      {editing && (
        <ReassignModal
          lineItem={editing}
          catalogItems={catalogOptions.data?.items ?? []}
          catalogOptionsError={catalogOptions.isError ? catalogOptions.error.message : undefined}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await queryClient.invalidateQueries();
            await queryClient.refetchQueries({ queryKey: ["catalog"] });
          }}
        />
      )}
    </section>
  );
}
