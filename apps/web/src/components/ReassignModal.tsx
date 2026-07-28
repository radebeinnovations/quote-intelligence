import type { CatalogSummary, LinkedLineItem } from "@quote-intelligence/domain";
import { useState } from "react";
import { api } from "../api";

interface ReassignModalProps {
  lineItem: Pick<
    LinkedLineItem,
    "id" | "description" | "supplierName" | "quoteNumber"
  >;
  catalogItems: CatalogSummary[];
  onClose: () => void;
  onSaved: () => void;
}

export function ReassignModal({
  lineItem,
  catalogItems,
  onClose,
  onSaved
}: ReassignModalProps) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [targetId, setTargetId] = useState(catalogItems[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.reassign(
        lineItem.id,
        mode === "existing"
          ? { targetCatalogItemId: targetId }
          : { newCatalogItemName: newName.trim() }
      );
      onSaved();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Correction failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reassign-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <p className="eyebrow">Correct catalog match</p>
        <h2 id="reassign-title">Where should this line belong?</h2>
        <div className="source-line">
          <small>Supplier wording</small>
          <strong>{lineItem.description}</strong>
          <span>{lineItem.supplierName} · {lineItem.quoteNumber}</span>
        </div>
        <form onSubmit={submit}>
          <div className="segmented-control">
            <button
              type="button"
              className={mode === "existing" ? "active" : ""}
              onClick={() => setMode("existing")}
            >
              Existing service
            </button>
            <button
              type="button"
              className={mode === "new" ? "active" : ""}
              onClick={() => setMode("new")}
            >
              Split into new
            </button>
          </div>
          {mode === "existing" ? (
            <label className="field">
              <span>Target catalog service</span>
              <select value={targetId} onChange={(event) => setTargetId(event.target.value)} required>
                <option value="" disabled>Select a service</option>
                {catalogItems.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              <span>New canonical service name</span>
              <input
                value={newName}
                minLength={2}
                maxLength={120}
                required
                onChange={(event) => setNewName(event.target.value)}
                placeholder="e.g. Premium cocktail bartender"
              />
            </label>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button
              className="button primary"
              disabled={saving || (mode === "existing" ? !targetId : newName.trim().length < 2)}
            >
              {saving ? "Saving…" : "Save correction"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
