import { useState } from "react";
import { api } from "../api";

interface CreateSupplierModalProps {
  onClose: () => void;
  onSaved: () => void;
}

export function CreateSupplierModal({ onClose, onSaved }: CreateSupplierModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      await api.createSupplier({
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined
      });
      onSaved();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to create supplier."
      );
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
        aria-labelledby="create-supplier-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <p className="eyebrow">Supplier Directory</p>
        <h2 id="create-supplier-title">Add New Supplier</h2>

        <form onSubmit={submit}>
          <label className="field">
            <span>Supplier / Company Name *</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Transport & Logistics"
              required
              minLength={2}
              maxLength={120}
              autoFocus
            />
          </label>

          <label className="field">
            <span>Email Address (Optional)</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. quotes@acmetransport.co.za"
            />
          </label>

          <label className="field">
            <span>Phone Number (Optional)</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. +27 11 555 0199"
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
              disabled={saving || name.trim().length < 2}
            >
              {saving ? "Creating…" : "Save Supplier"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
