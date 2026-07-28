import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
dotenv.config({ path: resolve(repositoryRoot, ".env") });

const environmentSchema = z.object({
  QUOTE_SOURCE_DIR: z.string().default("./candidate-pack/sample-quotes"),
  DOCUPIPE_API_KEY: z.string().min(1).optional(),
  DOCUPIPE_PARSE_ENDPOINT: z.string().url().optional(),
  DOCUPIPE_SCHEMA_ID: z.string().min(1).optional()
});

export interface IngestionConfig {
  sourceDirectory: string;
  docuPipeApiKey?: string;
  docuPipeParseEndpoint?: string;
  docuPipeSchemaId?: string;
}

export function loadIngestionConfig(): IngestionConfig {
  const environment = environmentSchema.parse(process.env);
  const sourceDirectory = isAbsolute(environment.QUOTE_SOURCE_DIR)
    ? environment.QUOTE_SOURCE_DIR
    : resolve(repositoryRoot, environment.QUOTE_SOURCE_DIR);
  return {
    sourceDirectory,
    ...(environment.DOCUPIPE_API_KEY
      ? { docuPipeApiKey: environment.DOCUPIPE_API_KEY }
      : {}),
    ...(environment.DOCUPIPE_PARSE_ENDPOINT
      ? { docuPipeParseEndpoint: environment.DOCUPIPE_PARSE_ENDPOINT }
      : {}),
    ...(environment.DOCUPIPE_SCHEMA_ID
      ? { docuPipeSchemaId: environment.DOCUPIPE_SCHEMA_ID }
      : {})
  };
}
