import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { createServiceDatabaseClient } from "@quote-intelligence/database";
import {
  createCatalogItemSchema,
  createSupplierSchema,
  reassignLineItemSchema
} from "@quote-intelligence/domain";
import dotenv from "dotenv";
import Fastify from "fastify";
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import { CatalogService } from "./catalog-service";
import {
  UploadIngestionError,
  UploadIngestionService,
  type UploadFileType,
  type UploadIngestionApi
} from "./upload-ingestion-service";

dotenv.config({
  path: resolve(fileURLToPath(new URL("../../../", import.meta.url)), ".env")
});

// Create a copy of a sample quote directly in the root directory for easy user testing
try {
  const rootDir = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const sampleSource = resolve(rootDir, "candidate-pack/sample-quotes/Nightjar_Quote_AwardsDinner.xlsx");
  const sampleTarget = resolve(rootDir, "SAMPLE_QUOTE_TO_TEST.xlsx");
  if (existsSync(sampleSource)) {
    copyFileSync(sampleSource, sampleTarget);
  }
} catch (e) {
  // Ignore fallback file creation errors
}

export type CatalogApiService = Pick<
  CatalogService,
  | "list"
  | "detail"
  | "unmatched"
  | "reassign"
  | "stats"
  | "suppliers"
  | "ingestionAudit"
  | "createSupplier"
  | "createCatalogItem"
  | "deleteSupplier"
  | "deleteCatalogItem"
>;

interface BuildServerOptions {
  catalog?: CatalogApiService;
  uploadIngestion?: UploadIngestionApi;
  logger?: boolean;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const catalog =
    options.catalog ?? new CatalogService(createServiceDatabaseClient());
  let uploadIngestion = options.uploadIngestion;
  const configuredOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    ...(process.env.WEB_ORIGIN ?? "").split(",")
  ]
    .map((origin) => origin.trim())
    .filter((origin, index, origins) => Boolean(origin) && origins.indexOf(origin) === index);

  await app.register(cors, {
    origin(origin, callback) {
      callback(null, !origin || configuredOrigins.includes(origin));
    }
  });
  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 0,
      fileSize: 25 * 1024 * 1024
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: "Invalid request",
        issues: error.issues
      });
    }
    const statusCode = error instanceof UploadIngestionError
      ? error.statusCode
      : typeof error === "object" && error !== null &&
          "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    return reply.status(statusCode).send({
      error: "The request could not be completed.",
      message: error instanceof Error ? error.message : String(error)
    });
  });

  app.get("/api/health", async () => ({
    status: "ok",
    service: "quote-intelligence-api"
  }));

  app.post("/api/ingest/upload", async (request, reply) => {
    if (!request.isMultipart()) {
      throw new UploadIngestionError("Expected a multipart/form-data upload.", 415);
    }
    const file = await request.file();
    if (!file) throw new UploadIngestionError("Attach one PDF or XLSX quote file.", 400);

    const filename = file.filename.split(/[\\/]/).pop()?.trim() ?? "";
    const extension = filename.match(/\.(pdf|xlsx)$/i)?.[0].toLowerCase() ?? "";
    if (extension !== ".pdf" && extension !== ".xlsx") {
      file.file.resume();
      throw new UploadIngestionError("Only .pdf and .xlsx quote files are supported.", 415);
    }
    const contents = await file.toBuffer();
    if (!contents.length) throw new UploadIngestionError("The uploaded file is empty.", 400);
    if (extension === ".pdf" && contents.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new UploadIngestionError("The uploaded file is not a valid PDF document.", 415);
    }
    if (
      extension === ".xlsx" &&
      !(contents[0] === 0x50 && contents[1] === 0x4b)
    ) {
      throw new UploadIngestionError("The uploaded file is not a valid XLSX workbook.", 415);
    }

    uploadIngestion ??= new UploadIngestionService();
    const result = await uploadIngestion.ingest({
      filename,
      fileType: extension.slice(1) as UploadFileType,
      contents
    });
    return reply.status(result.idempotent ? 200 : 201).send(result);
  });

  app.get("/api/catalog", async (request) => {
    const query = z
      .object({
        q: z.string().trim().max(100).default(""),
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50)
      })
      .parse(request.query);
    return catalog.list({ query: query.q, page: query.page, pageSize: query.pageSize });
  });

  app.post("/api/catalog", async (request, reply) => {
    const input = createCatalogItemSchema.parse(request.body);
    const item = await catalog.createCatalogItem(input);
    return reply.status(201).send(item);
  });

  app.get("/api/catalog/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const detail = await catalog.detail(id);
    if (!detail) return reply.status(404).send({ error: "Catalog item not found." });
    return detail;
  });

  app.delete("/api/catalog/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return catalog.deleteCatalogItem(id);
  });

  app.get("/api/line-items/unmatched", async () => catalog.unmatched());

  app.post("/api/line-items/:id/reassign", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = reassignLineItemSchema.parse(request.body);
    const outcome = await catalog.reassign(id, input);
    if (outcome.status === "line-item-not-found") {
      return reply.status(404).send({ error: "Line item not found." });
    }
    if (outcome.status === "target-not-found") {
      return reply.status(404).send({ error: "Target catalog item not found." });
    }
    return reply.status(201).send(outcome.result);
  });

  app.get("/api/stats", async () => catalog.stats());

  app.get("/api/suppliers", async (request) => {
    const query = z
      .object({
        from: z.string().date().optional(),
        to: z.string().date().optional()
      })
      .refine(({ from, to }) => !from || !to || from <= to, {
        message: "The start date must be on or before the end date."
      })
      .parse(request.query);
    return catalog.suppliers({
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {})
    });
  });

  app.post("/api/suppliers", async (request, reply) => {
    const input = createSupplierSchema.parse(request.body);
    const supplier = await catalog.createSupplier(input);
    return reply.status(201).send(supplier);
  });

  app.delete("/api/suppliers/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return catalog.deleteSupplier(id);
  });

  app.get("/api/ingestion-runs", async () => catalog.ingestionAudit());

  return app;
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntryPoint) {
  const app = await buildServer();
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen({ host: "127.0.0.1", port });
}
