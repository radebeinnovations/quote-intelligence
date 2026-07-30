import cors from "@fastify/cors";
import { createServiceDatabaseClient } from "@quote-intelligence/database";
import { reassignLineItemSchema } from "@quote-intelligence/domain";
import dotenv from "dotenv";
import Fastify from "fastify";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import { CatalogService } from "./catalog-service";

dotenv.config({
  path: resolve(fileURLToPath(new URL("../../../", import.meta.url)), ".env")
});

export type CatalogApiService = Pick<
  CatalogService,
  "list" | "detail" | "unmatched" | "reassign" | "stats" | "suppliers" | "ingestionAudit"
>;

interface BuildServerOptions {
  catalog?: CatalogApiService;
  logger?: boolean;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const catalog =
    options.catalog ?? new CatalogService(createServiceDatabaseClient());
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

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: "Invalid request",
        issues: error.issues
      });
    }
    return reply.status(500).send({
      error: "The request could not be completed.",
      message: error instanceof Error ? error.message : String(error)
    });
  });

  app.get("/api/health", async () => ({
    status: "ok",
    service: "quote-intelligence-api"
  }));

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

  app.get("/api/catalog/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const detail = await catalog.detail(id);
    if (!detail) return reply.status(404).send({ error: "Catalog item not found." });
    return detail;
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
