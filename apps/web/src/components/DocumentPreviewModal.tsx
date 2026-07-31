import type { IngestionDocumentAudit } from "@quote-intelligence/domain";
import { formatDate } from "../format";

interface DocumentPreviewModalProps {
  document: IngestionDocumentAudit;
  runId: string;
  onClose: () => void;
}

function safeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (warning): warning is string =>
      typeof warning === "string" && warning.trim().length > 0
  );
}

export function DocumentPreviewModal({
  document,
  runId,
  onClose
}: DocumentPreviewModalProps) {
  const warnings = safeWarnings(document.warnings);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal document-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="doc-preview-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="doc-preview-header">
          <span className="category-pill">{document.fileType.toUpperCase()}</span>
          <span className={`status-badge status-${document.status === "parsed" ? "good" : "warn"}`}>
            {document.status}
          </span>
        </div>

        <h2 id="doc-preview-title">{document.filename}</h2>
        <p className="doc-subtitle">
          Processed in Run <code>{runId.slice(0, 8)}</code> on {formatDate(document.createdAt)}
        </p>

        <div className="doc-meta-grid">
          <div>
            <span>SHA-256 Fingerprint</span>
            <code className="doc-hash-full">{document.sha256}</code>
          </div>
          <div>
            <span>Extraction Status</span>
            <strong>{document.status.toUpperCase()}</strong>
          </div>
          <div>
            <span>Warnings Found</span>
            <strong>{warnings.length}</strong>
          </div>
        </div>

        <div className="doc-section">
          <h3>Extraction Warnings &amp; Log</h3>
          {warnings.length > 0 ? (
            <ul className="doc-warning-box">
              {warnings.map((w, index) => (
                <li key={index}>
                  <span className="warning-bullet">⚠</span> {w}
                </li>
              ))}
            </ul>
          ) : (
            <div className="doc-clean-box">
              <span>✓</span> Document was parsed cleanly with 0 extraction warnings.
            </div>
          )}
        </div>

        <div className="doc-section">
          <h3>Document Quick View</h3>
          <div className="doc-mock-viewer">
            <div className="pdf-page-mock">
              <div className="pdf-page-header">
                <strong>{document.filename}</strong>
                <span>Source Quote Record</span>
              </div>
              <div className="pdf-page-body">
                <p><strong>SHA-256:</strong> <code>{document.sha256}</code></p>
                <p><strong>Status:</strong> {document.status}</p>
                <div className="pdf-extracted-lines">
                  <small>Extracted Audit Content:</small>
                  {warnings.length > 0 ? (
                    warnings.map((w, idx) => <div key={idx} className="line-warning-row">• {w}</div>)
                  ) : (
                    <div className="line-clean-row">• Line items parsed &amp; normalized into catalog.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="button primary" onClick={onClose}>
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
}
