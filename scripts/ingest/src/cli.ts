import {
  normalizeToExVat,
  validateExtractedDocument,
  type ExtractedDocument
} from "@quote-intelligence/domain";
import fg from "fast-glob";
import { extname, relative } from "node:path";
import { loadIngestionConfig } from "./config";
import { parseSouthAfricanDate } from "./date";
import { DocuPipeClient } from "./docupipe-client";
import { sha256File } from "./hash";
import { IngestionRepository } from "./persistence";
import { parseXlsxQuote } from "./xlsx-parser";

interface IngestionPreview {
  file: string;
  sha256: string;
  document?: ExtractedDocument;
  normalizedDate?: string;
  cached?: boolean;
  warnings: string[];
  status: "parsed" | "requires-docupipe" | "failed";
}

async function main() {
  const config = loadIngestionConfig();
  const dryRun = process.argv.includes("--dry-run");
  const pdfLimitArgument = process.argv.find((argument) => argument.startsWith("--pdf-limit="));
  const pdfLimit = pdfLimitArgument ? Number(pdfLimitArgument.split("=")[1]) : null;
  const canaryPdfFiles = [
    "BPH-25-038.pdf",
    "Cape Crew Quote - AwardsDinner.pdf",
    "KSS Quote 2025-09 MusicNight.pdf"
  ].slice(0, pdfLimit ?? 3);
  const files = await fg(["**/*.pdf", "**/*.xlsx"], {
    cwd: config.sourceDirectory,
    absolute: true,
    onlyFiles: true
  });

  if (files.length !== 51) {
    console.warn(`Expected 51 source documents, found ${files.length}.`);
  }

  const docuPipe =
    config.docuPipeApiKey && config.docuPipeParseEndpoint
      ? new DocuPipeClient({
          apiKey: config.docuPipeApiKey,
          parseEndpoint: config.docuPipeParseEndpoint,
          ...(config.docuPipeSchemaId ? { schemaId: config.docuPipeSchemaId } : {})
        })
      : null;
  const repository = dryRun ? null : new IngestionRepository();
  const ingestionRunId = repository ? await repository.startRun(files.length) : null;

  const previews: IngestionPreview[] = [];
  try {
    for (const file of files.sort()) {
      const displayPath = relative(config.sourceDirectory, file);
      const sha256 = await sha256File(file);
      const extension = extname(file).toLowerCase();

      const stored = repository ? await repository.findParsedDocument(sha256) : null;
      if (stored) {
        previews.push({
          file: displayPath,
          sha256,
          document: stored.document,
          normalizedDate: parseSouthAfricanDate(stored.document.quote.dateText),
          cached: true,
          warnings: stored.warnings,
          status: "parsed"
        });
        continue;
      }

      if (
        extension === ".pdf" &&
        (dryRun || !docuPipe || (pdfLimit !== null && !canaryPdfFiles.includes(displayPath)))
      ) {
        previews.push({
          file: displayPath,
          sha256,
          warnings: [
            dryRun || !docuPipe
              ? "PDF parsing requires configured DocuPipe credentials and endpoint."
              : `PDF skipped by canary limit of ${pdfLimit}.`
          ],
          status: "requires-docupipe"
        });
        continue;
      }

      try {
        const document =
          extension === ".xlsx"
            ? await parseXlsxQuote(file)
            : await docuPipe!.parsePdf(file);
        const normalizedDate = parseSouthAfricanDate(document.quote.dateText);
        const warnings = validateExtractedDocument(document).map(({ message }) => message);
        const taxPreview = normalizeToExVat(
          document.lineItems[0]!.unitRate,
          document.quote.taxBasis,
          document.quote.vatRate
        );
        if (taxPreview.amountExVat === null) warnings.push(taxPreview.reason);
        if (repository && ingestionRunId) {
          await repository.persistDocument({
            ingestionRunId,
            filename: displayPath,
            fileType: extension === ".pdf" ? "pdf" : "xlsx",
            sha256,
            document,
            normalizedDate,
            warnings
          });
        }
        previews.push({
          file: displayPath,
          sha256,
          document,
          normalizedDate,
          warnings,
          status: "parsed"
        });
      } catch (error) {
        previews.push({
          file: displayPath,
          sha256,
          warnings: [error instanceof Error ? error.message : String(error)],
          status: "failed"
        });
      }
    }
  } catch (error) {
    if (repository && ingestionRunId) await repository.failRun(ingestionRunId);
    throw error;
  }

  const summary = {
    documents: previews.length,
    parsed: previews.filter(({ status }) => status === "parsed").length,
    cached: previews.filter(({ cached }) => cached).length,
    requiresDocuPipe: previews.filter(({ status }) => status === "requires-docupipe").length,
    failed: previews.filter(({ status }) => status === "failed").length,
    warnings: previews.reduce((sum, item) => sum + item.warnings.length, 0)
  };

  console.log(JSON.stringify({ summary, documents: previews }, null, 2));

  if (repository && ingestionRunId) {
    await repository.finishRun(ingestionRunId, summary.failed);
  }
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
