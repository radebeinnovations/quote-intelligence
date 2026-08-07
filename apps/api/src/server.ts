import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import {
  createAuthenticatedDatabaseClient
} from "@quote-intelligence/database";
import {
  batchQuoteUploadSchema,
  batchQuoteUploadResultSchema,
  catalogNormalizationRetryResultSchema,
  authMeResponseSchema,
  createCatalogItemSchema,
  createSupplierSchema,
  createdSupplierResponseSchema,
  catalogDetailResponseSchema,
  catalogDetailQuerySchema,
  ingestionAuditResponseSchema,
  catalogListQuerySchema,
  catalogSummaryResponseSchema,
  paginatedCatalogResponseSchema,
  reassignLineItemResultSchema,
  reassignLineItemSchema,
  statsResponseSchema,
  supplierPerformanceResponseSchema,
  supplierProfileResponseSchema,
  unmatchedLineItemsResponseSchema,
  healthResponseSchema,
  mutationSuccessResponseSchema,
  supplierListQuerySchema,
  uploadQuoteResponseSchema
} from "@quote-intelligence/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import Fastify, {
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import { BatchIngestionService } from "./batch-ingestion-service";
import { CatalogService } from "./catalog-service";
import { describeUnknownError } from "./error-utils";
import {
  UploadIngestionError,
  UploadIngestionService,
  type UploadFileType,
  type UploadIngestionApi
} from "./upload-ingestion-service";

dotenv.config({
  path: resolve(fileURLToPath(new URL("../../../", import.meta.url)), ".env")
});

export type CatalogApiService = Pick<
  CatalogService,
  | "list"
  | "detail"
  | "unmatched"
  | "reassign"
  | "stats"
  | "suppliersPerformance"
  | "supplierProfile"
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
  uploadLimitBytes?: number;
}

interface RequestServices {
  catalog: CatalogApiService;
  database: SupabaseClient | null;
  userId: string;
  email: string | null;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 100 * 1024 * 1024
  });
  const configuredOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    ...(process.env.WEB_ORIGIN ?? "").split(",")
  ]
    .map((origin) => origin.trim())
    .filter((origin, index, origins) => Boolean(origin) && origins.indexOf(origin) === index);

  await app.register(cors, {
    origin:
      configuredOrigins.length === 1
        ? configuredOrigins[0]!
        : configuredOrigins,
    allowedHeaders: ["Content-Type", "Authorization"]
  });
  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 0,
      fileSize: options.uploadLimitBytes ?? 25 * 1024 * 1024
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "The request failed validation.",
        issues: error.issues
      });
    }
    const statusCode =
      error instanceof UploadIngestionError
        ? error.statusCode
        : typeof error === "object" && error !== null &&
            "statusCode" in error && typeof error.statusCode === "number"
          ? error.statusCode
          : 500;
    const labels: Record<number, string> = {
      400: "Bad Request",
      404: "Not Found",
      409: "Conflict",
      413: "Payload Too Large",
      415: "Unsupported Media Type",
      422: "Unprocessable Entity",
      500: "Internal Server Error",
      503: "Service Unavailable"
    };
    return reply.status(statusCode).send({
      error: labels[statusCode] ?? "Request Error",
      message: describeUnknownError(error)
    });
  });

  function requireJsonContentType(request: FastifyRequest): void {
    const mediaType = request.headers["content-type"]
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (!mediaType || !/^application\/(?:[\w.-]+\+)?json$/.test(mediaType)) {
      throw new UploadIngestionError(
        "Expected an application/json request body.",
        415
      );
    }
  }

  async function servicesFor(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<RequestServices | null> {
    if (options.catalog) {
      return {
        catalog: options.catalog,
        database: null,
        userId: "00000000-0000-4000-8000-000000000000",
        email: "test@example.com"
      };
    }

    const authorization = request.headers.authorization;
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      await reply.status(401).send({ error: "Authentication is required." });
      return null;
    }
    const database = createAuthenticatedDatabaseClient(token);
    const { data, error } = await database.auth.getUser(token);
    if (error || !data.user) {
      request.log.warn(
        {
          authError: error
            ? {
                name: error.name,
                message: error.message,
                status: error.status,
                code: error.code
              }
            : { message: "Supabase returned no user for the access token." }
        },
        "Supabase rejected an authenticated API request."
      );
      if (error?.name === "AuthRetryableFetchError") {
        await reply.status(503).send({
          error: "Authentication service is temporarily unavailable."
        });
        return null;
      }
      await reply.status(401).send({ error: "The access token is invalid or expired." });
      return null;
    }

    return {
      catalog: new CatalogService(database, data.user.id),
      database,
      userId: data.user.id,
      email: data.user.email ?? null
    };
  }

  app.get("/api/health", async () =>
    healthResponseSchema.parse({
      status: "ok",
      service: "quote-intelligence-api"
    })
  );

  app.get("/api/auth/me", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    return authMeResponseSchema.parse({ id: services.userId, email: services.email });
  });

  app.post("/api/ingest/upload", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
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
    if (extension === ".xlsx" && !(contents[0] === 0x50 && contents[1] === 0x4b)) {
      throw new UploadIngestionError("The uploaded file is not a valid XLSX workbook.", 415);
    }
    const ingestion =
      options.uploadIngestion ??
      (services.database
        ? new UploadIngestionService(services.database, services.userId)
        : null);
    if (!ingestion) {
      return reply.status(501).send({ error: "Upload service is unavailable in test mode." });
    }
    try {
      const result = await ingestion.ingest({
        filename,
        fileType: extension.slice(1) as UploadFileType,
        contents
      });
      return reply
        .status(result.idempotent ? 200 : 201)
        .send(uploadQuoteResponseSchema.parse(result));
    } finally {
      contents.fill(0);
    }
  });

  app.get("/api/catalog-categories", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    return await services.catalog.getCategories();
  });

  app.get("/api/catalog", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    return paginatedCatalogResponseSchema.parse(
      await services.catalog.list(catalogListQuerySchema.parse(request.query))
    );
  });

  app.post("/api/catalog", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    requireJsonContentType(request);
    const item = await services.catalog.createCatalogItem(
      createCatalogItemSchema.parse(request.body)
    );
    return reply.status(201).send(catalogSummaryResponseSchema.parse(item));
  });

  app.get("/api/catalog/:id", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const detail = await services.catalog.detail(id, input);
    if (!detail) {
      return reply.status(404).send({ error: "Not Found", message: "Catalog item not found." });
    }
    return catalogDetailResponseSchema.parse(detail);
  });

  app.delete("/api/catalog/:id", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const outcome = await services.catalog.deleteCatalogItem(id);
    if (!outcome.success) return reply.status(404).send({ error: "Not Found", message: "Catalog item not found." });
    return mutationSuccessResponseSchema.parse(outcome);
  });

  app.get("/api/line-items/unmatched", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    return unmatchedLineItemsResponseSchema.parse(
      await services.catalog.unmatched()
    );
  });

  app.post("/api/line-items/:id/reassign", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = reassignLineItemSchema.parse(request.body);
    const outcome = await services.catalog.reassign(id, input);
    if (outcome.status === "line-item-not-found") {
      return reply.status(404).send({ error: "Not Found", message: "Line item not found." });
    }
    if (outcome.status === "target-not-found") {
      return reply.status(404).send({ error: "Not Found", message: "Target catalog item not found." });
    }
    return reply.status(201).send(reassignLineItemResultSchema.parse(outcome.result));
  });

  app.get("/api/stats", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    return statsResponseSchema.parse(await services.catalog.stats());
  });

  app.get("/api/suppliers", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    return supplierPerformanceResponseSchema.parse(
      await services.catalog.suppliersPerformance(
        supplierListQuerySchema.parse(request.query)
      )
    );
  });

  app.post("/api/suppliers", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    requireJsonContentType(request);
    const supplier = await services.catalog.createSupplier(
      createSupplierSchema.parse(request.body)
    );
    return reply.status(201).send(createdSupplierResponseSchema.parse(supplier));
  });

  app.get("/api/suppliers/:id", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const profile = await services.catalog.supplierProfile(id);
    if (!profile) return reply.status(404).send({ error: "Not Found", message: "Supplier not found." });
    return supplierProfileResponseSchema.parse(profile);
  });

  app.delete("/api/suppliers/:id", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const outcome = await services.catalog.deleteSupplier(id);
    if (!outcome.success) return reply.status(404).send({ error: "Not Found", message: "Supplier not found." });
    return mutationSuccessResponseSchema.parse(outcome);
  });

  app.get("/api/ingestion-audit", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    return ingestionAuditResponseSchema.parse(
      await services.catalog.ingestionAudit()
    );
  });

  app.get("/api/ingestion-runs", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    return ingestionAuditResponseSchema.parse(await services.catalog.ingestionAudit());
  });

  app.post("/api/uploads/batch", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    if (!services.database) {
      return reply.status(501).send({ error: "Upload service is unavailable in test mode." });
    }
    requireJsonContentType(request);
    const input = batchQuoteUploadSchema.parse(request.body);
    const ingestion = new BatchIngestionService(
      services.database,
      services.userId
    );
    const result = await ingestion.ingest(input);
    return reply.status(202).send(batchQuoteUploadResultSchema.parse(result));
  });

  app.post("/api/uploads/retry-normalization", async (request, reply) => {
    const services = await servicesFor(request, reply);
    if (!services) return;
    if (!services.database) {
      return reply.status(501).send({
        error: "Catalog normalization is unavailable in test mode."
      });
    }
    const ingestion = new BatchIngestionService(
      services.database,
      services.userId
    );
    return catalogNormalizationRetryResultSchema.parse(
      await ingestion.retryPendingNormalizations()
    );
  });

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
