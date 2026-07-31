import { useState } from "react";
import { api } from "../api";
import { useModalAccessibility } from "../use-modal-accessibility";

interface CreateCatalogItemModalProps {
  onClose: () => void;
  onSaved: () => void;
}

const CATEGORIES = [
  "Transport",
  "Equipment Hire",
  "Power",
  "Staffing",
  "Catering & Venue",
  "General"
];

export function CreateCatalogItemModal({ onClose, onSaved }: CreateCatalogItemModalProps) {
  const dialogRef = useModalAccessibility(onClose);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Transport");
  const [pricingBasis, setPricingBasis] = useState("per vehicle-km");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      await api.createCatalogItem({
        name: name.trim(),
        category: category.trim(),
        pricingBasis: pricingBasis.trim(),
        description: description.trim() || undefined
      });
      onSaved();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to create catalog service."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-catalog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <p className="eyebrow">Procurement Catalog</p>
        <h2 id="create-catalog-title">Add Catalog Service</h2>

        <form onSubmit={submit}>
          <label className="field">
            <span>Canonical Service Name *</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 8-ton truck freight, per kilometre"
              required
              minLength={2}
              maxLength={120}
              autoFocus
            />
          </label>

          <label className="field">
            <span>Category *</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} required>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Pricing Basis / Unit *</span>
            <input
              type="text"
              value={pricingBasis}
              onChange={(e) => setPricingBasis(e.target.value)}
              placeholder="e.g. per vehicle-km, per item-day, per hour"
              required
              maxLength={50}
            />
          </label>

          <label className="field">
            <span>Description (Optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this canonical procurement service..."
              rows={3}
              maxLength={500}
            />
          </label>

          {error && <p className="form-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={saving || name.trim().length < 2 || !pricingBasis.trim()}
            >
              {saving ? "Creating…" : "Save Catalog Service"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
