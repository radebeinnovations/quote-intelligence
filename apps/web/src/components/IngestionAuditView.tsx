import type {
  IngestionDocumentAudit,
  IngestionRunAudit
} from "@quote-intelligence/domain";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { formatDate, formatNumber } from "../format";

function safeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (warning): warning is string =>
      typeof warning === "string" && warning.trim().length > 0
  );
}

function safeDocuments(run: IngestionRunAudit): IngestionDocumentAudit[] {
  if (!Array.isArray(run.documents)) return [];
  return run.documents.filter(
    (document): document is IngestionDocumentAudit =>
      Boolean(document) && typeof document === "object"
  );
}

function abbreviatedHash(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "Unavailable";
  const hash = value.trim();
  return hash.length > 16
    ? `${hash.slice(0, 8)}…${hash.slice(-8)}`
    : hash;
}

function abbreviatedId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "unknown";
  return value.trim().slice(0, 8);
}

function displayVersion(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "Unknown";
  const version = value.trim();
  return version.toLowerCase().startsWith("v") ? version : `v${version}`;
}

function displayDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Number.isNaN(Date.parse(value))
  ) {
    return "Date unknown";
  }
  return formatDate(value);
}

function runStatusClass(status: unknown): string {
  if (status === "completed") return "confidence-high";
  if (status === "completed_with_errors" || status === "running") {
    return "confidence-medium";
  }
  return "confidence-low";
}

function documentStatusClass(status: unknown): string {
  if (status === "parsed") return "audit-status-success";
  if (status === "failed") return "audit-status-error";
  return "audit-status-pending";
}

export function IngestionAuditView() {
  const audit = useQuery({
    queryKey: ["ingestion-audit"],
    queryFn: api.ingestionAudit
  });

  return (
    <section className="catalog-view audit-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Ingestion provenance</p>
          <h2>Parsing &amp; Audit Log</h2>
          <p>
            Track document extraction runs, SHA-256 idempotency hashes,
            DocuPipe/XLSX parsing status, and extraction warnings.
          </p>
        </div>
      </div>

      {audit.isLoading ? (
        <div className="detail-loading" role="status">
          Loading audit records…
        </div>
      ) : audit.isError ? (
        <div className="error-state" role="alert">
          <strong>Unable to load ingestion audit log</strong>
          <p>
            {audit.error instanceof Error
              ? audit.error.message
              : "An unexpected request error occurred."}
          </p>
        </div>
      ) : !audit.data || audit.data.length === 0 ? (
        <div className="empty-state">
          <span aria-hidden="true">⌁</span>
          <h3>No ingestion runs recorded</h3>
          <p>
            Run <code>npm run ingest</code> to extract the source documents and
            generate an auditable processing record.
          </p>
        </div>
      ) : (
        <div className="audit-list">
          {audit.data.map((run) => (
            <AuditRunCard run={run} key={run.id} />
          ))}
        </div>
      )}
    </section>
  );
}

function AuditRunCard({ run }: { run: IngestionRunAudit }) {
  const documents = safeDocuments(run);
  const warningCount = documents.reduce(
    (total, document) => total + safeWarnings(document.warnings).length,
    0
  );
  const status =
    typeof run.status === "string" && run.status.trim()
      ? run.status
      : "unknown";

  return (
    <article className="panel audit-run-card">
      <div className="panel-heading audit-run-heading">
        <div>
          <p className="eyebrow">Run {abbreviatedId(run.id)}</p>
          <h3>Ingestion run · {displayDate(run.startedAt)}</h3>
          <p className="audit-completed-date">
            {run.completedAt
              ? `Completed ${displayDate(run.completedAt)}`
              : "Processing has not recorded a completion time."}
          </p>
        </div>
        <div className="audit-badges">
          {warningCount > 0 && (
            <span className="audit-warning-badge">
              {formatNumber(warningCount)}{" "}
              {warningCount === 1 ? "warning" : "warnings"}
            </span>
          )}
          <span className={`confidence ${runStatusClass(status)}`}>
            {status.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      <div className="formula-values audit-run-metrics">
        <div>
          <span>Documents parsed</span>
          <strong>{formatNumber(run.documentCount ?? documents.length)}</strong>
        </div>
        <div>
          <span>Parsing errors</span>
          <strong className={run.errorCount > 0 ? "metric-warning" : ""}>
            {formatNumber(run.errorCount ?? 0)}
          </strong>
        </div>
        <div>
          <span>Parser version</span>
          <strong>{displayVersion(run.parserVersion)}</strong>
        </div>
        <div>
          <span>Matcher engine</span>
          <strong>{displayVersion(run.matchingVersion)}</strong>
        </div>
      </div>

      {documents.length === 0 ? (
        <div className="audit-documents-empty">
          No source documents are linked to this ingestion run.
        </div>
      ) : (
        <div className="table-scroll audit-table">
          <table>
            <caption className="sr-only">
              Source document extraction results for ingestion run{" "}
              {abbreviatedId(run.id)}
            </caption>
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>SHA-256 hash</th>
                <th>Extraction status</th>
                <th>Warning queue</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document, index) => {
                const warnings = safeWarnings(document.warnings);
                const documentStatus =
                  typeof document.status === "string" && document.status.trim()
                    ? document.status
                    : "unknown";

                return (
                  <tr key={document.id || `${run.id}-${index}`}>
                    <td>
                      <strong>
                        {typeof document.filename === "string" &&
                        document.filename.trim()
                          ? document.filename
                          : "Unnamed document"}
                      </strong>
                      <small>Added {displayDate(document.createdAt)}</small>
                    </td>
                    <td>
                      <span className="category-pill audit-file-type">
                        {typeof document.fileType === "string" &&
                        document.fileType.trim()
                          ? document.fileType.toUpperCase()
                          : "Unknown"}
                      </span>
                    </td>
                    <td>
                      <code
                        className="audit-hash"
                        title={
                          typeof document.sha256 === "string"
                            ? document.sha256
                            : undefined
                        }
                      >
                        {abbreviatedHash(document.sha256)}
                      </code>
                    </td>
                    <td>
                      <span
                        className={`audit-status ${documentStatusClass(
                          documentStatus
                        )}`}
                      >
                        {documentStatus.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td>
                      {warnings.length > 0 ? (
                        <div className="audit-warning-cell">
                          <span className="audit-warning-badge">
                            {formatNumber(warnings.length)}{" "}
                            {warnings.length === 1 ? "warning" : "warnings"}
                          </span>
                          <ul className="audit-warning-list">
                            {warnings.map((warning, warningIndex) => (
                              <li key={`${document.id}-warning-${warningIndex}`}>
                                {warning}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <span className="audit-clean-badge">Clean</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
