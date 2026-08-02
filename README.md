# Quote Intelligence

Quote Intelligence converts supplier quotations for Bokmakierie Events into a secure,
searchable procurement catalog. Authenticated users can compare normalized historical
prices, inspect original evidence, understand a transparent fair-price benchmark, and
correct catalog matches without changing immutable source records.

The repository implements the SupaTech take-home brief and the platform-overhaul scope
with React, TypeScript, Fastify, Supabase/PostgreSQL, DocuPipe, and OpenAI structured
normalization.

## Architecture

```text
apps/
  web/          React, Vite, React Query, Recharts, accessible vanilla CSS
  api/          Fastify; the only browser-facing application/database boundary
packages/
  domain/       Zod API contracts, units, VAT, and fair-price mathematics
  database/     Authenticated and service-role Supabase client factories
scripts/
  ingest/       XLSX/PDF extraction, persistence, and catalog matching CLIs
supabase/
  migrations/  PostgreSQL schema, views, RLS, audit controls, and private storage
candidate-pack/
  sample-quotes/  51 assessment documents from ten South African suppliers
```

The browser uses the Supabase publishable key only for authentication. Every API
request carries the user's access token. Fastify creates a token-bound Supabase client,
so PostgreSQL row-level security remains the final tenant boundary. The service-role key
is confined to trusted server-side identity validation and offline ingestion.

## Implemented product surface

- Email/password authentication with isolated React Query caches per session.
- Tenant-scoped catalog, suppliers, quotes, source documents, matches, overrides,
  normalizations, ingestion runs, and catalog variants.
- Search, category filtering, date ranges, pagination, and multi-column catalog sorting.
- Fair-price cards, IQR evidence, supplier comparisons, and multi-variant price charts.
- Unmatched/review queue and auditable line-item reassignment or catalog splitting.
- Batch PDF/XLSX upload with per-file results and empty-account bootstrap states.
- Supplier performance and supplier profiles with total spend, competitiveness,
  quote history, exact extracted lines, and links to private original files.
- Ingestion audit cards with parser/model versions, hashes, warnings, and errors.
- CSV exports for catalog benchmarks and linked supplier evidence.
- Responsive dark/light themes, keyboard-accessible modals, and loading/error/empty states.

## Security and data integrity

Migration `202608020001_multi_tenant_platform.sql` adds tenant ownership and enforces it
with RLS plus composite tenant foreign keys. It also creates the private
`quote-source-files` storage bucket; object paths begin with the authenticated user ID.
Signed URLs are generated only for records visible to that user.

Raw data is append-only in normal operation:

1. `ingestion_runs` and `source_documents` retain provenance, SHA-256 hashes, parser
   versions, raw extraction JSON, warnings, storage paths, and timestamps.
2. `suppliers`, `quotes`, and `quote_line_items` preserve the supplier's source values.
3. `catalog_items` represents stable base profiles; `catalog_item_variants` contains
   protected dimensions and packaging variants.
4. `catalog_matches` stores machine decisions and confidence.
5. `catalog_match_overrides` records corrections, including the previous catalog and
   variant, without overwriting the generated match or raw line.
6. `price_normalizations` records ex-VAT canonical rates, bases, estimation flags,
   explanations, and model metadata.
7. `normalized_price_observations` resolves the latest human override over the generated
   match and supplies the analytical projection.

Database triggers prevent tenant reassignment after ownership is established and protect
source-document identity, completed raw extraction, and raw quote fields from mutation.

## Extraction and normalization pipeline

### PDF

PDFs are uploaded to DocuPipe, polled to completion, standardized into the extraction
schema, and validated with Zod. The full response and warning trail are retained. The
normalized description is then sent to OpenAI using strict JSON Schema output. The
default model is `gpt-4o-mini`, configurable through `OPENAI_MODEL`.

### XLSX

XLSX files are parsed directly with `fflate` and `fast-xml-parser`. The reader processes
Open XML data only, never executes workbook macros, and locates labeled metadata and
line-item headers instead of relying on filenames or fixed row numbers.

### Structured extraction shape

```ts
{
  supplier: { name, vatNumber?, contactName?, email?, phone?, address? },
  quote: {
    quoteNumber, revisionNumber?, dateText, eventName?, currency,
    vatRate, taxBasis, subtotal?, vatAmount?, total?
  },
  lineItems: [{
    sourceRow?, description, quantity, unit, unitRate, lineTotal
  }],
  notes: []
}
```

The pipeline validates document signatures, file types, file size, required fields,
`quantity × rate`, subtotals, VAT, totals, and duplicate SHA-256 content. Numeric dates
are parsed day-first. Warnings remain visible; inconsistent rows are not silently fixed.

## Catalog matching and variants

Matching is precision-first because a false merge is as damaging as a missed match.

1. Normalize case, punctuation, whitespace, and common supplier wording.
2. Generate deterministic candidates and an OpenAI structured canonical suggestion.
3. Apply hard protected-attribute gates after the model response.
4. Reuse an existing base profile and variant only when the dimensions and pricing basis
   are compatible; otherwise create a separate variant or leave the line unmatched.
5. Exclude unmatched, low-confidence, invalid, superseded, or non-comparable evidence
   from fair-price calculations.

Protected attributes include generator kVA, gazebo dimensions, vehicle tonnage/capacity,
day versus night security, and per-hour/per-day/per-trip/per-kilometre bases. A model
cannot override these deterministic guards. Base profiles consolidate the real-world
service while variants preserve meaningful configurations and packaging.

Users can reassign a line to an existing catalog item and variant or split it into a new
catalog item. Reassignment recalculates normalization against the target basis. An
incompatible conversion remains visible but is marked non-comparable instead of carrying
a stale price into analytics.

## VAT and unit normalization

All analytics are ZAR excluding VAT. The default South African VAT rate is 15%.

```text
exclusive rate     -> unchanged
inclusive rate     -> rate / 1.15
unknown tax basis  -> retained as evidence, excluded from comparable analytics
```

Explicit supported conversions include:

```text
staff hour          -> person-hour
4-hour callout      -> rate / 4 person-hours
12-hour shift       -> rate / 12 person-hours
Nightjar day        -> rate / 10 person-hours, estimated with explanation
24-hour equipment   -> item-day
```

Per-kilometre and per-trip transport remain separate. Packages remain separate from
standalone components unless the source provides an exact, defensible allocation.

## Fair-price definition

Eligible evidence must be from the current quote revision, matched to the selected
catalog variant, arithmetically valid, ex-VAT normalized, and comparable on the canonical
unit basis.

When at least three eligible observations fall in the latest 180 days:

```text
fair price = 0.70 * overall median + 0.30 * recent-180-day median
```

Otherwise the fair price is the overall median. The UI exposes the medians, filtered
mean, sample and supplier counts, exclusions, observations, confidence score, and
1.5×IQR bounds. IQR outliers are highlighted and excluded from the displayed trimmed
mean, but retained in the robust median benchmark.

## South African data decisions

- Currency defaults to ZAR; dates display as `DD/MM/YYYY`.
- Explicit VAT-inclusive rates are divided by 1.15; unknown tax bases remain reviewable.
- Revision records are preserved. Only the highest active revision contributes to
  analytics.
- Source arithmetic mismatches generate warnings and are excluded from fair pricing.
- Similar bundles, protected configurations, and incompatible bases are not merged.
- Supplier total spend uses source line totals; performance compares normalized eligible
  rates with the corresponding market fair price. No misleading average-price metric is
  used.

## Local setup

Requirements: Node.js 20+, npm 10+, a Supabase project, DocuPipe credentials for PDFs,
and OpenAI credentials for AI-assisted normalization.

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and supply:

```dotenv
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
DATABASE_URL=...
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
DOCUPIPE_API_KEY=...
DOCUPIPE_PARSE_ENDPOINT=https://api.docupipe.ai/v1/parse
QUOTE_SOURCE_DIR=./candidate-pack/sample-quotes
INGEST_USER_ID=...
API_PORT=3001
WEB_ORIGIN=http://localhost:5173
```

`INGEST_USER_ID` is the Supabase Auth UUID that owns records created by the offline CLI.
Never commit `.env`, expose service/model keys to the browser, or paste secrets into issue
trackers. Rotate any credential that has been publicly disclosed.

### 3. Apply migrations

For a fresh local project:

```bash
supabase start
supabase db reset
```

For hosted Supabase:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Existing pre-tenant rows have a null owner after the schema migration. Assign and verify
one owner before relying on authenticated UI counts. Audit and resolve duplicates before
adding ownership where a tenant-scoped uniqueness rule would be violated.

### 4. Validate extraction without PDF credits

```bash
npm run ingest:dry-run
```

The expected assessment inventory is ten directly parsed XLSX files and 41 PDFs marked
as requiring DocuPipe.

### 5. Ingest and match

Start with the representative PDF canary:

```bash
npm run ingest -w @quote-intelligence/ingest -- --pdf-limit=3
```

Review audit warnings, then process the corpus and run deterministic catalog matching:

```bash
npm run ingest
npm run catalog:match
```

SHA-256 idempotency reuses completed documents for the same tenant and avoids duplicate
DocuPipe charges.

### 6. Run the application

```bash
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:3001`
- Health: `http://localhost:3001/api/health`

### 7. Verify

```bash
npm run typecheck
npm test
npm run build
```

The networked Supabase fixture test is deliberately separate:

```bash
npm run test:integration -w @quote-intelligence/api
```

## API

Except for health, routes require `Authorization: Bearer <Supabase access token>`.
Request and response payloads are parsed with contracts in `@quote-intelligence/domain`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Public liveness and version |
| GET | `/api/auth/me` | Validate and return the current identity |
| GET | `/api/stats` | Tenant totals and date range |
| GET | `/api/catalog` | Search, category/date filter, sort, and paginate catalog |
| POST | `/api/catalog` | Create a base catalog profile |
| GET | `/api/catalog/:id` | Variant-aware history, benchmark, suppliers, and raw lines |
| DELETE | `/api/catalog/:id` | Soft-deactivate a catalog profile |
| GET | `/api/line-items/unmatched` | Review unmatched/low-confidence lines |
| POST | `/api/line-items/:id/reassign` | Write an auditable override and recalculate basis |
| GET | `/api/suppliers` | Date-filtered supplier performance |
| POST | `/api/suppliers` | Create a supplier |
| GET | `/api/suppliers/:id` | Supplier profile, vault, quotes, and exact lines |
| DELETE | `/api/suppliers/:id` | Soft-deactivate a supplier |
| GET | `/api/ingestion-audit` | Runs and documents, newest first |
| POST | `/api/uploads/batch` | Upload up to 20 PDF/XLSX files to the AI pipeline |
| POST | `/api/ingest/upload` | Backward-compatible single multipart upload |

## Known limitations

- DocuPipe and OpenAI calls consume external credits and need durable production queues,
  retries, concurrency controls, and cost telemetry.
- Matching rules are deliberately conservative and the review queue remains part of the
  normal workflow for novel supplier vocabulary.
- The confidence value is an evidence heuristic, not a statistical confidence interval.
- Geographic, seasonal, event-size, and negotiated-volume effects are not modeled.
- Hosted integration tests require a dedicated Supabase test tenant and credentials.
- The current charting package should be upgraded in a planned dependency pass.

## With another week

1. Move extraction and normalization to a durable job queue with idempotent retries.
2. Add an administrator catalog/variant editor with merge and rollback workflows.
3. Add human-approved embedding candidate generation behind protected-attribute gates.
4. Add ephemeral Supabase integration environments to CI, including cross-tenant RLS tests.
5. Add monitoring for DocuPipe/OpenAI cost, latency, failures, and model drift.
6. Model region, seasonality, quantity tiers, and negotiated-volume effects after enough
   clean evidence exists.
