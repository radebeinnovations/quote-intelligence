create or replace view public.normalized_price_observations as
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
