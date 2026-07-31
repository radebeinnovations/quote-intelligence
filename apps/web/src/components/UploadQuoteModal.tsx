import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { UploadQuoteResponse } from "@quote-intelligence/domain";
import { api, type QuoteUploadProgress } from "../api";
import { formatNumber, zar } from "../format";

interface UploadQuoteModalProps {
  onClose: () => void;
}

type UploadStatus = "idle" | "uploading" | "parsing" | "success" | "error";

function supportedFile(file: File): boolean {
  return /\.(pdf|xlsx)$/i.test(file.name);
}

export function UploadQuoteModal({ onClose }: UploadQuoteModalProps) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState<QuoteUploadProgress>({
    phase: "uploading",
    percent: 0
  });
  const [dragging, setDragging] = useState(false);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<UploadQuoteResponse | null>(null);
  const busy = status === "uploading" || status === "parsing";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  async function beginUpload(file: File) {
    if (!supportedFile(file)) {
      setError("Choose a PDF or XLSX quote file.");
      setStatus("error");
      return;
    }
    setFilename(file.name);
    setError("");
    setResult(null);
    setStatus("uploading");
    try {
      const response = await api.uploadQuote(file, (nextProgress) => {
        setProgress(nextProgress);
        setStatus(nextProgress.phase);
      });
      setResult(response);
      setStatus("success");
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["stats"] }),
        queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
        queryClient.invalidateQueries({ queryKey: ["unmatched-line-items"] }),
        queryClient.invalidateQueries({ queryKey: ["ingestion-audit"] })
      ]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Quote upload failed.");
      setStatus("error");
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = event.dataTransfer.files[0];
    if (file) void beginUpload(file);
  }

  function reset() {
    setStatus("idle");
    setProgress({ phase: "uploading", percent: 0 });
    setFilename("");
    setError("");
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const matchedCount = result?.lineItems.filter(
    ({ match }) => match.status === "matched"
  ).length ?? 0;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={() => { if (!busy) onClose(); }}
    >
      <div
        className="modal upload-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-quote-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="icon-button modal-close"
          onClick={onClose}
          aria-label="Close upload"
          disabled={busy}
        >
          ×
        </button>
        <p className="eyebrow">Direct ingestion</p>
        <h2 id="upload-quote-title">Upload Quote PDF</h2>
        <p className="upload-intro">
          Drop a supplier quote here. PDF and XLSX files are extracted, matched,
          and saved to the audit trail automatically.
        </p>

        {!result && (
          <div
            className={`quote-dropzone ${dragging ? "is-dragging" : ""} ${busy ? "is-busy" : ""}`}
            role="button"
            tabIndex={busy ? -1 : 0}
            aria-disabled={busy}
            onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={handleDrop}
            onClick={() => { if (!busy) inputRef.current?.click(); }}
            onKeyDown={(event) => {
              if (!busy && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
          >
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept=".pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void beginUpload(file);
              }}
            />
            <span className="upload-icon" aria-hidden="true">⇧</span>
            <strong>{busy ? filename : "Drag and drop a quote"}</strong>
            <span>{busy ? "Keep this window open while extraction completes" : "or click to browse · PDF / XLSX · 25 MB max"}</span>
          </div>
        )}

        {busy && (
          <div className="upload-progress" aria-live="polite">
            <div className="upload-progress-copy">
              <strong>{status === "uploading" ? "Uploading document" : "Parsing and matching quote"}</strong>
              <span>
                {status === "uploading" && progress.percent !== null
                  ? `${progress.percent}%`
                  : "Extracting supplier, lines, and catalog matches…"}
              </span>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Quote ingestion progress"
              aria-valuemin={0}
              aria-valuemax={100}
              {...(status === "uploading" && progress.percent !== null
                ? { "aria-valuenow": progress.percent }
                : { "aria-valuetext": "Parsing document" })}
            >
              <div
                className={`progress-fill ${status === "parsing" ? "is-indeterminate" : ""}`}
                style={status === "uploading" && progress.percent !== null
                  ? { width: `${progress.percent}%` }
                  : undefined}
              />
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="upload-error" role="alert">
            <strong>Could not ingest {filename || "this file"}</strong>
            <p>{error}</p>
            <button className="button secondary compact" onClick={reset}>Choose another file</button>
          </div>
        )}

        {result && (
          <div className="upload-results" aria-live="polite">
            <div className="upload-success-heading">
              <span className="upload-success-mark">✓</span>
              <div>
                <strong>{result.supplier.name}</strong>
                <span>
                  Quote {result.quote.quoteNumber} · {result.idempotent ? "Already ingested" : "Saved to Quote Intelligence"}
                </span>
              </div>
              {result.idempotent && <span className="basis-pill">Duplicate detected</span>}
            </div>
            <div className="upload-result-metrics">
              <div><span>Extracted lines</span><strong>{formatNumber(result.lineItems.length)}</strong></div>
              <div><span>Catalog matches</span><strong>{formatNumber(matchedCount)}</strong></div>
              <div><span>Warnings</span><strong>{formatNumber(result.warnings.length)}</strong></div>
            </div>

            <div className="upload-lines">
              <table>
                <thead>
                  <tr><th>Extracted line</th><th>Qty / unit</th><th>Rate</th><th>Catalog match</th></tr>
                </thead>
                <tbody>
                  {result.lineItems.map((line) => (
                    <tr key={line.id}>
                      <td><strong>{line.description}</strong><small>{zar.format(line.lineTotal)} total</small></td>
                      <td>{formatNumber(line.quantity)} <small>{line.unit}</small></td>
                      <td>{zar.format(line.unitRate)}</td>
                      <td>
                        {line.match.catalogItemName ? (
                          <span className="upload-match-pill">✓ {line.match.catalogItemName}</span>
                        ) : (
                          <span className="upload-unmatched-pill">Needs review</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result.warnings.length > 0 && (
              <details className="upload-warnings">
                <summary>{result.warnings.length} extraction warning{result.warnings.length === 1 ? "" : "s"}</summary>
                <ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              </details>
            )}
            <div className="modal-actions">
              <button className="button secondary" onClick={reset}>Upload another</button>
              <button className="button primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
