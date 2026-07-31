create extension if not exists pgcrypto;

create type public.ingestion_status as enum ('running', 'completed', 'completed_with_errors', 'failed');
create type public.extraction_status as enum ('pending', 'processing', 'parsed', 'failed');
create type public.tax_basis as enum ('inclusive', 'exclusive', 'unknown');
create type public.validation_status as enum ('valid', 'warning', 'invalid');
create type public.match_status as enum ('matched', 'review', 'unmatched');
create type public.match_method as enum ('exact_rule', 'alias', 'fuzzy', 'manual');
create type public.normalization_status as enum ('normalized', 'estimated', 'not_comparable', 'failed');

create table public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status public.ingestion_status not null default 'running',
  parser_version text not null,
  matching_version text not null,
  document_count integer not null default 0 check (document_count >= 0),
  error_count integer not null default 0 check (error_count >= 0)
);

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  ingestion_run_id uuid not null references public.ingestion_runs(id) on delete restrict,
  filename text not null,
  file_type text not null check (file_type in ('pdf', 'xlsx')),
  sha256 text not null check (length(sha256) = 64),
  docupipe_document_id text,
  extraction_status public.extraction_status not null default 'pending',
  raw_extraction jsonb,
  extraction_warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sha256)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  display_name text not null,
  vat_number text unique,
  email text,
  phone text,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null unique references public.source_documents(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  quote_number text not null,
  revision_number integer not null default 0 check (revision_number >= 0),
  supersedes_quote_id uuid references public.quotes(id) on delete set null,
  is_current_revision boolean not null default true,
  quote_date date not null,
  event_name text,
  currency char(3) not null default 'ZAR',
  vat_rate numeric(6,5) not null default 0.15 check (vat_rate >= 0 and vat_rate <= 1),
  tax_basis public.tax_basis not null default 'unknown',
  subtotal_raw numeric(14,2),
  vat_amount_raw numeric(14,2),
  total_raw numeric(14,2),
  validation_status public.validation_status not null default 'valid',
  validation_warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, quote_number, revision_number)
);

create unique index one_current_quote_revision
  on public.quotes (supplier_id, quote_number)
  where is_current_revision;

create table public.quote_line_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  source_row text,
  description_raw text not null,
  quantity_raw numeric(14,4) not null check (quantity_raw > 0),
  unit_raw text not null,
  unit_rate_raw numeric(14,4) not null check (unit_rate_raw >= 0),
  line_total_raw numeric(14,2) not null check (line_total_raw >= 0),
  currency char(3) not null default 'ZAR',
  tax_basis public.tax_basis not null,
  unit_rate_ex_vat numeric(14,4),
  line_total_ex_vat numeric(14,2),
  arithmetic_valid boolean not null,
  normalization_status public.normalization_status not null default 'not_comparable',
  normalization_warnings jsonb not null default '[]'::jsonb,
  extraction_confidence numeric(5,4) check (
    extraction_confidence is null or
    (extraction_confidence >= 0 and extraction_confidence <= 1)
  ),
  created_at timestamptz not null default now()
);

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null,
  description text,
  canonical_unit text not null,
  canonical_pricing_basis text not null,
  attributes jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.catalog_matches (
  id uuid primary key default gen_random_uuid(),
  line_item_id uuid not null unique references public.quote_line_items(id) on delete cascade,
  catalog_item_id uuid references public.catalog_items(id) on delete restrict,
  status public.match_status not null,
  method public.match_method,
  confidence numeric(5,4) check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  ),
  reason_codes jsonb not null default '[]'::jsonb,
  matched_at timestamptz not null default now(),
  check (
    (status = 'unmatched' and catalog_item_id is null) or
    (status <> 'unmatched' and catalog_item_id is not null)
  )
);

create table public.catalog_match_overrides (
  id uuid primary key default gen_random_uuid(),
  line_item_id uuid not null references public.quote_line_items(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id) on delete restrict,
  previous_catalog_item_id uuid references public.catalog_items(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create unique index latest_catalog_override_per_line
  on public.catalog_match_overrides (line_item_id, created_at desc);

create table public.unit_conversions (
  id uuid primary key default gen_random_uuid(),
  from_unit text not null,
  to_unit text not null,
  factor numeric(16,8) not null check (factor > 0),
  conditions jsonb not null default '{}'::jsonb,
  confidence numeric(5,4) not null default 1 check (confidence >= 0 and confidence <= 1),
  notes text,
  unique (from_unit, to_unit, conditions)
);

create table public.price_normalizations (
  line_item_id uuid primary key references public.quote_line_items(id) on delete cascade,
  canonical_rate_ex_vat numeric(14,4),
  canonical_basis text,
  estimated boolean not null default false,
  comparable boolean not null default false,
  explanation text not null,
  normalized_at timestamptz not null default now(),
  check (
    (comparable and canonical_rate_ex_vat is not null and canonical_basis is not null) or
    (not comparable)
  )
);

create view public.normalized_price_observations as
select
  li.id as line_item_id,
  q.id as quote_id,
  q.quote_number,
  q.quote_date,
  q.is_current_revision,
  s.id as supplier_id,
  s.display_name as supplier_name,
  coalesce(o.catalog_item_id, m.catalog_item_id) as catalog_item_id,
  li.description_raw,
  li.quantity_raw,
  li.unit_raw,
  li.unit_rate_raw,
  li.line_total_raw,
  li.tax_basis,
  li.unit_rate_ex_vat,
  pn.canonical_rate_ex_vat,
  pn.canonical_basis,
  pn.estimated,
  pn.comparable,
  pn.explanation,
  li.arithmetic_valid,
  q.validation_status,
  sd.created_at as source_created_at
from public.quote_line_items li
join public.quotes q on q.id = li.quote_id
join public.source_documents sd on sd.id = q.source_document_id
join public.suppliers s on s.id = q.supplier_id
left join public.catalog_matches m on m.line_item_id = li.id
left join lateral (
  select cmo.catalog_item_id
  from public.catalog_match_overrides cmo
  where cmo.line_item_id = li.id
  order by cmo.created_at desc
  limit 1
) o on true
left join public.price_normalizations pn on pn.line_item_id = li.id
left join public.catalog_items ci on ci.id = coalesce(o.catalog_item_id, m.catalog_item_id)
where s.active and (ci.id is null or ci.active);

create index source_documents_run_idx on public.source_documents (ingestion_run_id);
create index quotes_supplier_date_idx on public.quotes (supplier_id, quote_date);
create index quotes_active_date_idx on public.quotes (quote_date) where is_current_revision;
create index line_items_quote_idx on public.quote_line_items (quote_id);
create index catalog_matches_item_idx on public.catalog_matches (catalog_item_id);

alter table public.ingestion_runs enable row level security;
alter table public.source_documents enable row level security;
alter table public.suppliers enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_line_items enable row level security;
alter table public.catalog_items enable row level security;
alter table public.catalog_matches enable row level security;
alter table public.catalog_match_overrides enable row level security;
alter table public.unit_conversions enable row level security;
alter table public.price_normalizations enable row level security;

comment on schema public is
  'Quote Intelligence data. Browser access is intentionally denied by default; the Fastify API uses the service role.';
