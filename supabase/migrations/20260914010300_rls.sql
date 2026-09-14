revoke all on public.sources from anon, authenticated;
revoke all on public.offers from anon, authenticated;
revoke all on public.ingestion_runs from anon, authenticated;

alter table public.sources enable row level security;
alter table public.offers enable row level security;
alter table public.ingestion_runs enable row level security;

-- offers: anon may read every column of ACTIVE rows only. No offer column
-- is internal (ingestion metadata lives in ingestion_runs, not here).
grant select on public.offers to anon;
create policy "anon can read active offers"
  on public.offers
  for select
  to anon
  using (status = 'active');

-- sources: anon may read only freshness/attribution fields, never adapter
-- configuration, the employer identifier, or the allowed-hosts allowlist.
grant select (key, name, countries, enabled, last_success_at, attribution_url)
  on public.sources to anon;
create policy "anon can read source freshness"
  on public.sources
  for select
  to anon
  using (true);

-- ingestion_runs: fully internal. No grant, no policy => anon gets a
-- permission-denied result for every operation, including SELECT.
-- (service_role has BYPASSRLS in Supabase and needs no policy here.)
