-- Quote Intelligence platform expansion: tenant isolation, catalog variants, and source vault.
-- Existing assessment data remains nullable/legacy and is intentionally invisible to authenticated
-- tenants until explicitly assigned to an owner.

drop view if exists public.normalized_price_observations;

alter type public.match_method add value if not exists 'llm';

alter table public.ingestion_runs
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists normalization_model text;
alter table public.source_documents
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists storage_path text;
alter table public.suppliers
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.quotes
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.quote_line_items
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.catalog_items
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists is_base_profile boolean not null default true;
alter table public.catalog_matches
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists model_version text,
  add column if not exists normalization_metadata jsonb not null default '{}'::jsonb;
alter table public.catalog_match_overrides
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists previous_variant_id uuid;
alter table public.price_normalizations
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.source_documents drop constraint if exists source_documents_sha256_key;
alter table public.suppliers drop constraint if exists suppliers_vat_number_key;
alter table public.quotes drop constraint if exists quotes_supplier_id_quote_number_revision_number_key;
alter table public.catalog_items drop constraint if exists catalog_items_name_key;

alter table public.source_documents
  add constraint source_documents_user_sha_key unique (user_id, sha256);
alter table public.suppliers
  add constraint suppliers_user_vat_key unique (user_id, vat_number),
  add constraint suppliers_user_name_key unique (user_id, canonical_name);
alter table public.quotes
  add constraint quotes_user_supplier_number_revision_key
  unique (user_id, supplier_id, quote_number, revision_number);
alter table public.catalog_items
  add constraint catalog_items_user_name_key unique (user_id, name);

drop index if exists public.one_current_quote_revision;
create unique index one_current_quote_revision
  on public.quotes (user_id, supplier_id, quote_number)
  where is_current_revision;

create table if not exists public.catalog_item_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id) on delete cascade,
  label text not null,
  attributes jsonb not null default '{}'::jsonb,
  canonical_unit text not null,
  canonical_pricing_basis text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, catalog_item_id, label)
);

alter table public.catalog_matches
  add column if not exists variant_id uuid references public.catalog_item_variants(id) on delete restrict;
alter table public.catalog_match_overrides
  add column if not exists variant_id uuid references public.catalog_item_variants(id) on delete restrict;
alter table public.price_normalizations
  add column if not exists variant_id uuid references public.catalog_item_variants(id) on delete set null;

create index if not exists ingestion_runs_user_started_idx
  on public.ingestion_runs (user_id, started_at desc);
create index if not exists source_documents_user_created_idx
  on public.source_documents (user_id, created_at desc);
create index if not exists suppliers_user_name_idx
  on public.suppliers (user_id, display_name);
create index if not exists quotes_user_date_idx
  on public.quotes (user_id, quote_date desc);
create index if not exists catalog_items_user_category_idx
  on public.catalog_items (user_id, category, name);
create index if not exists catalog_variants_item_idx
  on public.catalog_item_variants (catalog_item_id, active);
create unique index if not exists catalog_items_user_name_ci_key
  on public.catalog_items (user_id, lower(name))
  where user_id is not null;
create unique index if not exists catalog_variants_user_label_ci_key
  on public.catalog_item_variants (user_id, catalog_item_id, lower(label));

-- Composite tenant keys prevent an authenticated tenant from creating a row that
-- points at another tenant's UUID, even if that UUID were discovered externally.
alter table public.ingestion_runs
  add constraint ingestion_runs_id_user_key unique (id, user_id);
alter table public.source_documents
  add constraint source_documents_id_user_key unique (id, user_id),
  add constraint source_documents_run_user_fkey
    foreign key (ingestion_run_id, user_id)
    references public.ingestion_runs (id, user_id) on delete restrict;
alter table public.suppliers
  add constraint suppliers_id_user_key unique (id, user_id);
alter table public.quotes
  add constraint quotes_id_user_key unique (id, user_id),
  add constraint quotes_source_user_fkey
    foreign key (source_document_id, user_id)
    references public.source_documents (id, user_id) on delete restrict,
  add constraint quotes_supplier_user_fkey
    foreign key (supplier_id, user_id)
    references public.suppliers (id, user_id) on delete restrict;
alter table public.quote_line_items
  add constraint quote_line_items_id_user_key unique (id, user_id),
  add constraint quote_line_items_quote_user_fkey
    foreign key (quote_id, user_id)
    references public.quotes (id, user_id) on delete cascade;
alter table public.catalog_items
  add constraint catalog_items_id_user_key unique (id, user_id);
alter table public.catalog_item_variants
  add constraint catalog_item_variants_id_user_key unique (id, user_id),
  add constraint catalog_item_variants_catalog_user_fkey
    foreign key (catalog_item_id, user_id)
    references public.catalog_items (id, user_id) on delete cascade;
alter table public.catalog_matches
  add constraint catalog_matches_line_user_fkey
    foreign key (line_item_id, user_id)
    references public.quote_line_items (id, user_id) on delete cascade,
  add constraint catalog_matches_catalog_user_fkey
    foreign key (catalog_item_id, user_id)
    references public.catalog_items (id, user_id) on delete restrict,
  add constraint catalog_matches_variant_user_fkey
    foreign key (variant_id, user_id)
    references public.catalog_item_variants (id, user_id) on delete restrict;
alter table public.catalog_match_overrides
  add constraint catalog_match_overrides_line_user_fkey
    foreign key (line_item_id, user_id)
    references public.quote_line_items (id, user_id) on delete cascade,
  add constraint catalog_match_overrides_catalog_user_fkey
    foreign key (catalog_item_id, user_id)
    references public.catalog_items (id, user_id) on delete restrict,
  add constraint catalog_match_overrides_variant_user_fkey
    foreign key (variant_id, user_id)
    references public.catalog_item_variants (id, user_id) on delete restrict,
  add constraint catalog_match_overrides_previous_variant_user_fkey
    foreign key (previous_variant_id, user_id)
    references public.catalog_item_variants (id, user_id) on delete restrict;
alter table public.price_normalizations
  add constraint price_normalizations_line_user_fkey
    foreign key (line_item_id, user_id)
    references public.quote_line_items (id, user_id) on delete cascade,
  add constraint price_normalizations_variant_user_fkey
    foreign key (variant_id, user_id)
    references public.catalog_item_variants (id, user_id);

create or replace function public.protect_source_document_payload()
returns trigger
language plpgsql
as $$
begin
  if (old.user_id is not null and new.user_id is distinct from old.user_id)
    or new.ingestion_run_id is distinct from old.ingestion_run_id
    or new.filename is distinct from old.filename
    or new.file_type is distinct from old.file_type
    or new.sha256 is distinct from old.sha256
    or (old.storage_path is not null and new.storage_path is distinct from old.storage_path)
    or (old.raw_extraction is not null and new.raw_extraction is distinct from old.raw_extraction)
  then
    raise exception 'Source document identity and completed raw extraction are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists source_document_payload_immutable on public.source_documents;
create trigger source_document_payload_immutable
before update on public.source_documents
for each row execute function public.protect_source_document_payload();

create or replace function public.protect_quote_payload()
returns trigger
language plpgsql
as $$
begin
  if (old.user_id is not null and new.user_id is distinct from old.user_id)
    or new.source_document_id is distinct from old.source_document_id
    or new.supplier_id is distinct from old.supplier_id
    or new.quote_number is distinct from old.quote_number
    or new.revision_number is distinct from old.revision_number
    or new.quote_date is distinct from old.quote_date
    or new.event_name is distinct from old.event_name
    or new.currency is distinct from old.currency
    or new.vat_rate is distinct from old.vat_rate
    or new.tax_basis is distinct from old.tax_basis
    or new.subtotal_raw is distinct from old.subtotal_raw
    or new.vat_amount_raw is distinct from old.vat_amount_raw
    or new.total_raw is distinct from old.total_raw
  then
    raise exception 'Raw quote fields are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists quote_payload_immutable on public.quotes;
create trigger quote_payload_immutable
before update on public.quotes
for each row execute function public.protect_quote_payload();

create view public.normalized_price_observations
with (security_invoker = true) as
select
  q.user_id,
  li.id as line_item_id,
  q.id as quote_id,
  q.quote_number,
  q.quote_date,
  q.is_current_revision,
  q.total_raw as quote_total_raw,
  sd.created_at as source_created_at,
  s.id as supplier_id,
  s.display_name as supplier_name,
  coalesce(o.catalog_item_id, m.catalog_item_id) as catalog_item_id,
  case when o.catalog_item_id is not null then 'matched'::public.match_status else m.status end
    as match_status,
  case
    when o.catalog_item_id is not null then o.variant_id
    else m.variant_id
  end as variant_id,
  v.label as variant_label,
  coalesce(v.attributes, '{}'::jsonb) as variant_attributes,
  li.source_row,
  li.description_raw,
  li.quantity_raw,
  li.unit_raw,
  li.unit_rate_raw,
  li.line_total_raw,
  li.line_total_ex_vat,
  li.tax_basis,
  li.unit_rate_ex_vat,
  pn.canonical_rate_ex_vat,
  pn.canonical_basis,
  pn.estimated,
  pn.comparable,
  pn.explanation,
  li.arithmetic_valid,
  q.validation_status
from public.quote_line_items li
join public.quotes q on q.id = li.quote_id
join public.source_documents sd on sd.id = q.source_document_id
join public.suppliers s on s.id = q.supplier_id
left join public.catalog_matches m on m.line_item_id = li.id
left join lateral (
  select cmo.catalog_item_id, cmo.variant_id
  from public.catalog_match_overrides cmo
  where cmo.line_item_id = li.id
  order by cmo.created_at desc
  limit 1
) o on true
left join public.catalog_item_variants v
  on v.id = case
    when o.catalog_item_id is not null then o.variant_id
    else m.variant_id
  end
left join public.price_normalizations pn on pn.line_item_id = li.id
left join public.catalog_items ci
  on ci.id = coalesce(o.catalog_item_id, m.catalog_item_id)
where s.active and (ci.id is null or ci.active);

alter table public.catalog_item_variants enable row level security;

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array[
    'ingestion_runs',
    'source_documents',
    'suppliers',
    'quotes',
    'quote_line_items',
    'catalog_items',
    'catalog_item_variants',
    'catalog_matches',
    'catalog_match_overrides',
    'price_normalizations'
  ] loop
    execute format('drop policy if exists tenant_isolation on public.%I', tenant_table);
    execute format(
      'create policy tenant_isolation on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      tenant_table
    );
  end loop;
end $$;

drop policy if exists authenticated_unit_conversion_read on public.unit_conversions;
create policy authenticated_unit_conversion_read
  on public.unit_conversions for select to authenticated using (true);

grant select, insert, update on public.ingestion_runs to authenticated;
grant select, insert, update on public.source_documents to authenticated;
grant select, insert, update on public.suppliers to authenticated;
grant select, insert, update on public.quotes to authenticated;
grant select, insert on public.quote_line_items to authenticated;
grant select, insert, update, delete on public.catalog_items to authenticated;
grant select, insert, update, delete on public.catalog_item_variants to authenticated;
grant select, insert on public.catalog_matches to authenticated;
grant select, insert, delete on public.catalog_match_overrides to authenticated;
grant select, insert, update on public.price_normalizations to authenticated;
grant select on public.unit_conversions to authenticated;
grant select on public.normalized_price_observations to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quote-source-files',
  'quote-source-files',
  false,
  26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists tenant_quote_files_select on storage.objects;
create policy tenant_quote_files_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'quote-source-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists tenant_quote_files_insert on storage.objects;
create policy tenant_quote_files_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'quote-source-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists tenant_quote_files_delete on storage.objects;
create policy tenant_quote_files_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'quote-source-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

comment on column public.catalog_items.name is
  'Tenant-scoped canonical base profile name; variant dimensions live in catalog_item_variants.';
comment on column public.source_documents.storage_path is
  'Private Supabase Storage path in the quote-source-files bucket.';
comment on schema public is
  'Quote Intelligence tenant data; authenticated access is restricted by user-scoped RLS and composite tenant foreign keys.';
