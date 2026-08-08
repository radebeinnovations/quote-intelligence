import { useMutation } from "@tanstack/react-query";
import type { BatchQuoteUploadInput } from "@quote-intelligence/domain";
import { useState, type DragEvent } from "react";
import { api } from "../api";
import { useModalAccessibility } from "../use-modal-accessibility";

const acceptedTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

export function UploadQuoteModal({
  onClose,
  onUploaded = () => undefined
}: {
  onClose: () => void;
  onUploaded?: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const dialog = useModalAccessibility(onClose);
  const upload = useMutation({
    mutationFn: async () =>
      api.uploadQuotes({
        files: await Promise.all(files.map(serializeFile))
      }),
    onSuccess: onUploaded
  });

  function addFiles(nextFiles: File[]) {
    const valid = nextFiles.filter(
      (file) => Boolean(mimeTypeFor(file)) && file.size <= 25 * 1024 * 1024
    );
    setFiles((current) => {
      const deduplicated = new Map(
        [...current, ...valid].map((file) => [
          `${file.name}-${file.size}-${file.lastModified}`,
          file
        ])
      );
      return [...deduplicated.values()];
    });
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropActive(false);
    addFiles([...event.dataTransfer.files]);
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (!upload.isPending) onClose();
      }}
    >
      <div
        ref={dialog}
        className="modal upload-modal"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          data-autofocus
          className="icon-button modal-close"
          onClick={onClose}
          aria-label="Close upload dialog"
          disabled={upload.isPending}
        >
          ×
        </button>
        <p className="eyebrow">Catalog onboarding</p>
        <h2 id="upload-title">Upload supplier quotes</h2>
        <p className="modal-intro">
          Add unlimited PDF or XLSX quotes. Originals remain in your private vault;
          extraction and catalog normalization preserve every raw source line.
        </p>

        <div
          className={`upload-dropzone ${dropActive ? "active" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={drop}
        >
          <span className="upload-icon" aria-hidden="true">⇧</span>
          <strong>Drop PDF/XLSX files here</strong>
          <span>or choose files from your computer · 25 MB each</span>
          <label className="button secondary compact upload-picker">
            Choose files
            <input
              type="file"
              multiple
              accept=".pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => addFiles([...(event.target.files ?? [])])}
            />
          </label>
        </div>

        {files.length > 0 && (
          <div className="upload-file-list" aria-label="Selected files">
            {files.map((file) => (
              <div key={`${file.name}-${file.size}-${file.lastModified}`}>
                <span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>
                <button
                  className="icon-button"
                  aria-label={`Remove ${file.name}`}
                  disabled={upload.isPending}
                  onClick={() =>
                    setFiles((current) => current.filter((item) => item !== file))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {upload.isError && (
          <p className="form-error" role="alert">{upload.error.message}</p>
        )}
        {upload.data && (
          <div className="upload-result" role="status">
            <strong>{upload.data.accepted} document(s) processed</strong>
            <span>
              {upload.data.documents.filter(({ status }) => status === "parsed").length}
              {" succeeded · "}
              {upload.data.documents.filter(({ status }) => status === "failed").length}
              {" require attention"}
            </span>
          </div>
        )}

        <div className="modal-actions">
          <button className="button secondary" onClick={onClose} disabled={upload.isPending}>
            {upload.data ? "Done" : "Cancel"}
          </button>
          {!upload.data && (
            <button
              className="button primary"
              disabled={!files.length || upload.isPending}
              onClick={() => upload.mutate()}
            >
              {upload.isPending ? "Extracting & normalizing…" : `Process ${files.length || ""} quote${files.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

async function serializeFile(
  file: File
): Promise<BatchQuoteUploadInput["files"][number]> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  const contentBase64 = dataUrl.split(",", 2)[1];
  if (!contentBase64) throw new Error(`Could not encode ${file.name}.`);
  return {
    filename: file.name,
    mimeType: mimeTypeFor(file)!,
    contentBase64
  };
}

function mimeTypeFor(
  file: File
): BatchQuoteUploadInput["files"][number]["mimeType"] | null {
  if (acceptedTypes.has(file.type)) {
    return file.type as BatchQuoteUploadInput["files"][number]["mimeType"];
  }
  if (/\.pdf$/i.test(file.name)) return "application/pdf";
  if (/\.xlsx$/i.test(file.name)) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
