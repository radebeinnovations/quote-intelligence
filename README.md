# Quote Intelligence MVP

Quote Intelligence turns Bokmakierie Events' supplier quotations into a searchable
catalog of comparable services. Procurement users can see historical prices, compare
suppliers on a common pricing basis, understand a transparent fair-price estimate, and
correct catalog matches without editing PostgreSQL manually.

The repository implements the SupaTech take-home brief using React, TypeScript,
Fastify, Supabase/PostgreSQL, DocuPipe for PDFs, and a focused ZIP/XML spreadsheet
reader for XLSX.

## Architecture

```text
apps/
  web/          React/Vite procurement interface
  api/          Fastify API; the only browser-facing database boundary
packages/
  domain/       Shared schemas, API types, validation, unit and fair-price logic
  database/     Server-side Supabase client
scripts/
  ingest/       PDF/XLSX extraction, persistence and catalog matching CLIs
supabase/
  migrations/  PostgreSQL schema
candidate-pack/
  sample-quotes/  51 supplied assessment documents
```

The browser never receives the Supabase service-role key. Fastify performs reads and
corrections, while ingestion scripts use the service role from a trusted local process.
Row-level security is enabled without public policies by default.

## What is implemented

- Paginated, searchable catalog API and catalog browser.
- Item detail API with chronological price history, supplier aggregation, fair-price
  evidence, and linked source lines.
- User-facing reassignment and split controls backed by immutable override records.
- A review queue exposes conservative non-matches and lets users assign them without
  editing PostgreSQL directly.
- Overview statistics for quotes, suppliers, catalog items, line items, and date range.
- Direct, read-only XLSX ingestion for the ten Nightjar and Swift Move workbooks.
- Configurable DocuPipe structured extraction for all PDF quotes.
- SHA-256 document idempotency and ingestion-run audit records.
- Quote revision preservation. Only the highest revision is active for analytics.
- Day-first South African date parsing and ZAR defaults.
- VAT-inclusive to ex-VAT normalization.
- Conservative deterministic catalog rules with protected attributes.
- Staffing conversion to person-hour, equipment hire to item-day, and separate
  per-kilometre/per-trip transport bases.

## Database model

The initial migration is
[`supabase/migrations/202607240001_initial_schema.sql`](supabase/migrations/202607240001_initial_schema.sql).

The main layers are:

1. `ingestion_runs` and `source_documents` preserve provenance, hashes, raw DocuPipe
   responses, and extraction warnings.
2. `suppliers`, `quotes`, and `quote_line_items` preserve source values. Raw amounts
   are never overwritten by cleaned amounts.
3. `catalog_items` stores canonical real-world services.
4. `catalog_matches` stores generated matching decisions and confidence.
5. `catalog_match_overrides` stores user corrections separately so generated and
   human decisions remain auditable.
6. `price_normalizations` records the canonical ex-VAT rate, basis, whether the
   conversion is estimated, and its explanation.
7. `normalized_price_observations` resolves the latest manual override over a
   generated match and supplies the API's analytical projection.

## Extraction schema

DocuPipe receives a structured JSON schema covering:

```ts
{
  supplier: {
    name,
    vatNumber?,
    contactName?,
    email?,
    phone?,
    address?
  },
  quote: {
    quoteNumber,
    revisionNumber?,
    dateText,
    eventName?,
    currency,
    vatRate,
    taxBasis,
    subtotal?,
    vatAmount?,
    total?
  },
  lineItems: [{
    sourceRow?,
    description,
    quantity,
    unit,
    unitRate,
    lineTotal
  }],
  notes: []
}
```

`dateText` deliberately preserves the document representation. The ingestion layer
then parses it using South African conventions and stores an ISO PostgreSQL date.
DocuPipe output is validated with Zod and retained as JSON before normalization.

The XLSX parser uses `fflate` and `fast-xml-parser` to read the Open XML worksheet
without loading macros or executing workbook content. It locates labeled metadata and the
`Description | Qty | Unit | Rate | Amount` header rather than relying on a filename or
fixed row offset. Numeric cells remain numeric and are independently reconciled.

### Extraction validation

The pipeline checks:

- `quantity × unit rate` against each source line total;
- line totals against the quoted subtotal;
- VAT against the stated subtotal and rate;
- required supplier, quote, date, and line-item fields;
- duplicate documents using SHA-256;
- revision suffixes such as `(Rev 2)`.

Warnings are retained rather than silently changing the supplier document. For
example, the inconsistent Event Crew total in `JES-26-057` remains visible and is
excluded from fair-price analytics.

## Catalog matching strategy

Matching is intentionally precision-first because a false merge is as harmful as a
missed match.

1. Normalize case, whitespace, punctuation, and supplier wording.
2. Resolve curated aliases such as waiter/waitstaff/waitron and
   event crew/general crew/setup-and-breakdown crew.
3. Preserve protected attributes:
   - day versus night security;
   - 20 kVA versus 40 kVA generators;
   - 3×3 m versus 5×5 m gazebos;
   - vehicle capacity;
   - person, platter, trip, kilometre, event, and package pricing bases.
4. Match only explicit, reviewed patterns with a high confidence score.
5. Leave unknown descriptions unmatched instead of guessing.

The current MVP uses deterministic aliases and regular-expression attributes because
they are explainable and reproducible across this small corpus. A future matcher can
add token similarity or embeddings only as candidate-generation tools; protected
attribute gates and human review should remain authoritative.

Run matching after ingestion:

```bash
npm run catalog:match
```

The UI shows raw supplier descriptions and provides **Reassign**. A user can select an
existing service or split a line into a new catalog item. The original generated match
is not destroyed. Reassignment recalculates the canonical price using the target
catalog basis; incompatible moves remain visible but are excluded from fair-price
analytics instead of silently carrying a stale normalization.

## Unit and VAT normalization

All analytics are shown in ZAR excluding VAT.

```text
exclusive source rate → unchanged
inclusive source rate → source rate ÷ 1.15
unknown tax basis     → visible, but excluded from comparable analytics
```

Approved staffing conversions:

```text
hour             → person-hour, unchanged
4-hour callout   → rate ÷ 4
12-hour shift    → rate ÷ 12
Nightjar day     → rate ÷ 10, marked estimated
```

Nightjar states that a staff day covers *up to* ten hours, so its hourly conversion is
an estimate and is labeled as such. Equipment explicitly billed for a 24-hour hire is
normalized to item-day.

Thabo's per-kilometre transport and Swift Move's flat trip pricing remain separate.
Swift's “within 60 km” condition is not an exact journey distance and cannot support an
honest per-kilometre conversion. All-in production packages also remain separate from
their standalone components.

## Fair-price definition

Only observations satisfying all of the following contribute:

- current quote revision;
- known VAT basis and normalized ex-VAT rate;
- compatible canonical unit;
- valid line arithmetic.

The baseline is the median because this is a small, intentionally messy dataset with
material outliers. When there are at least three observations in the latest 180 days:

```text
fair price = 0.70 × overall median + 0.30 × recent median
```

Otherwise:

```text
fair price = overall median
```

The UI also displays mean, sample count, supplier count, excluded count, observations,
and confidence. Confidence is a bounded evidence score based 60% on sample count and
40% on supplier diversity; it is not a statistical confidence interval.

Outliers are identified using the 1.5×IQR rule. They are highlighted but retained in
the median. This preserves evidence such as Kokerboom's R625 standard buffet without
letting the application erase an inconvenient source value.

## Messy-data decisions

- Default currency is ZAR and VAT is 15%, unless a quote states otherwise.
- Numeric dates are day-first except explicit year-first dates.
- Both decimal comma and decimal point source formats are accepted by extraction.
- Cape Crew and Swift Move rates are VAT-inclusive and divided by 1.15.
- Kokerboom documents that explicitly say prices include VAT are treated as inclusive.
  The ambiguous Activation quote remains `unknown` until reviewed.
- `BPH-26-058 (Rev 2)` supersedes the original quote. Both remain queryable, but only
  Revision 2 contributes to active analytics.
- Source arithmetic mismatches are warnings, not automatic corrections.
- Similar-looking bundles and standalone services are separate catalog entries.

## Local setup

Requirements:

- Node.js 20 or newer
- npm 10 or newer
- Docker for local Supabase, or a hosted Supabase project
- A DocuPipe account/API key for PDF extraction

### 1. Install

```bash
npm install
```

### 2. Configure the environment

Copy `.env.example` to `.env` and set:

```dotenv
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
DATABASE_URL=...
DOCUPIPE_API_KEY=...
DOCUPIPE_PARSE_ENDPOINT=https://app.docupipe.ai
QUOTE_SOURCE_DIR=./candidate-pack/sample-quotes
```

`DOCUPIPE_PARSE_ENDPOINT` is explicit so deployments can follow DocuPipe endpoint
changes without a code release. The client uploads each PDF, polls the asynchronous
parse job, submits the parsed document to `/v3/standardize`, polls that job, and then
validates the structured result with Zod.

### 3. Apply PostgreSQL migration

With the Supabase CLI installed:

```bash
supabase start
supabase db reset
```

For hosted Supabase, link the project and run:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

### 4. Validate extraction without consuming PDF credits

```bash
npm run ingest:dry-run
```

This parses all ten XLSX files and reports the 41 PDFs as requiring DocuPipe.

### 5. Test DocuPipe on representative PDFs

Run the built-in three-PDF canary, which selects representative Berghaan, Cape Crew,
and Karoo Sound & Stage layouts:

```bash
npm run ingest -w @quote-intelligence/ingest -- --pdf-limit=3
```

Inspect extraction and reconciliation warnings, then process the full folder and
match the catalog:

```bash
npm run ingest
npm run catalog:match
```

Successfully parsed documents are reused by SHA-256 on later runs, avoiding duplicate
DocuPipe processing and preserving existing line-item mappings.

### 6. Start the application

```bash
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:3001`
- API health: `http://localhost:3001/api/health`

### 7. Verify

```bash
npm run typecheck
npm test
npm run build
```

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/stats` | Dataset totals and date range |
| GET | `/api/catalog?q=&page=&pageSize=` | Searchable paginated catalog summaries |
| GET | `/api/catalog/:id` | Price history, comparison, benchmark, linked lines |
| GET | `/api/line-items/unmatched` | Conservative non-matches for the review queue |
| POST | `/api/line-items/:id/reassign` | Reassign or split a match |
| POST | `/api/ingest/upload` | Ingest one PDF/XLSX quote from multipart field `file` (25 MB max) |

The upload endpoint hashes the file with SHA-256, returns the existing extraction for
duplicate content, and otherwise parses, persists, audits, and catalog-matches the quote
before returning its supplier and line-by-line extraction summary.

Reassignment body accepts exactly one:

```json
{ "targetCatalogItemId": "uuid" }
```

or:

```json
{ "newCatalogItemName": "Premium cocktail bartender" }
```

## Known limitations

- DocuPipe processing requires user-provided credentials and consumes account credits.
  The supplied 51-document corpus has been processed successfully with the current
  asynchronous upload, job-polling, and standardization API.
- DocuPipe polling is in-process; production ingestion should use a durable queue with
  retry/backoff, idempotency telemetry, and credit monitoring.
- The rules cover the supplied corpus, not an unlimited supplier vocabulary.
- New catalog items created in the correction modal inherit the raw unit and are marked
  for review; a full catalog editor would ask for category and canonical basis.
- The modal loads the first 100 catalog entries. Server-side option search is preferable
  for a much larger catalog.
- No authentication or multi-tenancy is included, as required by the brief.
- Geographic, seasonality, and event-size effects are not modeled.
- Confidence is an evidence heuristic, not inferential statistics.
- The database integration is verified against Supabase, but automated integration
  tests still need an ephemeral PostgreSQL/Supabase environment.

## With another week

1. Add a durable DocuPipe job queue with retry/backoff, credit tracking, and extraction review.
2. Add a dedicated low-confidence/unmatched review queue and full catalog editor.
3. Preserve stable line-item identities across changed document re-ingestion.
4. Add embedding-based candidate suggestions behind protected-attribute gates.
5. Add database integration tests against ephemeral Supabase/PostgreSQL.
6. Add robust statistical intervals once the dataset is large enough.
7. Add authentication, audit-user identity, deployment, monitoring, and backups.
