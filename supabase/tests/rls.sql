-- Executable assertions against a real Supabase/Postgres instance,
-- covering both directions of the security model:
--   1. anon can read only the intended public surface and can never write.
--   2. service_role (the collector's own credential) can perform exactly
--      the operations it needs — proving BYPASSRLS alone is NOT enough;
--      the explicit GRANTs in 20260914010700_service_role_grants.sql and
--      the SECURITY DEFINER finalize functions are what make this work.
-- Plus a real-database check that the canonical-fingerprint duplicate
-- constraint actually rejects a collision.
--
-- Every assertion below either RAISE NOTICEs "PASS: ..." or RAISE
-- EXCEPTIONs "FAIL: ...". An uncaught exception gives psql/the SQL editor
-- a non-zero exit / visible error, so "no error" means every assertion
-- passed. The whole script runs inside a transaction that is rolled back
-- at the end, so it never leaves fixture data behind.
--
-- See supabase/tests/README.md for how to run this (requires the
-- `anon`/`authenticated`/`service_role` roles — supabase/tests/bootstrap-roles.sql
-- creates them on a plain Postgres instance that doesn't already have
-- Supabase's own role setup).

begin;

insert into public.sources (key, name, adapter, employer_identifier, attribution_url, allowed_hosts, countries)
values ('test-source', 'Test Source', 'smartrecruiters', 'TestCo', 'https://jobs.smartrecruiters.com/TestCo', array['api.smartrecruiters.com'], array['MA','FR']);

insert into public.offers (source_key, external_id, source_url, apply_url, canonical_url_hash, title, company, country, language, status)
values
  ('test-source', 'active-1', 'https://jobs.smartrecruiters.com/TestCo/1', 'https://jobs.smartrecruiters.com/TestCo/1/apply', 'hash-active-1', 'Stage Developpeur', 'TestCo', 'MA', 'fr', 'active'),
  ('test-source', 'inactive-1', 'https://jobs.smartrecruiters.com/TestCo/2', 'https://jobs.smartrecruiters.com/TestCo/2/apply', 'hash-inactive-1', 'Stage Data', 'TestCo', 'FR', 'fr', 'inactive');

insert into public.ingestion_runs (source_key, status, scan_complete)
values ('test-source', 'succeeded', true);

-- =====================================================================
-- Part 1: anon — read-only, and only the intended surface
-- =====================================================================

set local role anon;

do $$
declare
  visible_count integer;
begin
  select count(*) into visible_count from public.offers;
  if visible_count <> 1 then
    raise exception 'FAIL: anon should see exactly 1 active offer, saw %', visible_count;
  end if;
  if exists (select 1 from public.offers where status = 'inactive') then
    raise exception 'FAIL: anon must never see inactive offers';
  end if;
  raise notice 'PASS: anon sees only active offers';
end $$;

do $$
begin
  perform 1 from public.ingestion_runs limit 1;
  raise exception 'FAIL: anon must not be able to select from ingestion_runs';
exception
  when insufficient_privilege then
    raise notice 'PASS: anon cannot select ingestion_runs';
end $$;

do $$
begin
  perform employer_identifier from public.sources limit 1;
  raise exception 'FAIL: anon must not be able to select sources.employer_identifier';
exception
  when insufficient_privilege then
    raise notice 'PASS: anon cannot select sources.employer_identifier';
end $$;

do $$
begin
  perform allowed_hosts from public.sources limit 1;
  raise exception 'FAIL: anon must not be able to select sources.allowed_hosts';
exception
  when insufficient_privilege then
    raise notice 'PASS: anon cannot select sources.allowed_hosts';
end $$;

do $$
begin
  update public.offers set title = 'hacked' where true;
  raise exception 'FAIL: anon must not be able to update offers';
exception
  when insufficient_privilege then
    raise notice 'PASS: anon cannot update offers';
end $$;

do $$
begin
  insert into public.offers (source_key, external_id, source_url, apply_url, canonical_url_hash, title, company, country, language)
  values ('test-source', 'anon-insert', 'https://jobs.smartrecruiters.com/x', 'https://jobs.smartrecruiters.com/x/apply', 'h', 'x', 'x', 'MA', 'fr');
  raise exception 'FAIL: anon must not be able to insert offers';
exception
  when insufficient_privilege then
    raise notice 'PASS: anon cannot insert offers';
end $$;

do $$
begin
  delete from public.offers where true;
  raise exception 'FAIL: anon must not be able to delete offers';
exception
  when insufficient_privilege then
    raise notice 'PASS: anon cannot delete offers';
end $$;

do $$
begin
  insert into public.sources (key, name, adapter, employer_identifier, attribution_url)
  values ('hacked', 'x', 'x', 'x', 'https://example.com');
  raise exception 'FAIL: anon must not be able to insert sources';
exception
  when insufficient_privilege then
    raise notice 'PASS: anon cannot insert sources';
end $$;

reset role;

-- =====================================================================
-- Part 2: service_role — proves BYPASSRLS is not enough on its own; the
-- explicit GRANTs and SECURITY DEFINER functions are what make these
-- operations actually work.
-- =====================================================================

set local role service_role;

do $$
begin
  insert into public.offers (source_key, external_id, source_url, apply_url, canonical_url_hash, title, company, country, language)
  values ('test-source', 'service-role-insert', 'https://jobs.smartrecruiters.com/TestCo/3', 'https://jobs.smartrecruiters.com/TestCo/3/apply', 'hash-sr-1', 'Stage Cloud', 'TestCo', 'FR', 'fr');
  raise notice 'PASS: service_role can insert offers';
exception
  when insufficient_privilege then
    raise exception 'FAIL: service_role should be able to insert offers (explicit GRANT missing)';
end $$;

do $$
begin
  update public.offers set title = 'updated by service_role' where external_id = 'service-role-insert';
  raise notice 'PASS: service_role can update offers';
exception
  when insufficient_privilege then
    raise exception 'FAIL: service_role should be able to update offers (explicit GRANT missing)';
end $$;

do $$
declare
  v_run_id uuid;
begin
  insert into public.ingestion_runs (source_key, status) values ('test-source', 'running')
    returning id into v_run_id;
  if v_run_id is null then
    raise exception 'FAIL: service_role insert into ingestion_runs did not return an id';
  end if;
  raise notice 'PASS: service_role can insert into ingestion_runs and read back the generated id';
exception
  when insufficient_privilege then
    raise exception 'FAIL: service_role should be able to insert into ingestion_runs (explicit GRANT missing)';
end $$;

do $$
begin
  perform key from public.sources where key = 'test-source';
  raise notice 'PASS: service_role can select sources';
exception
  when insufficient_privilege then
    raise exception 'FAIL: service_role should be able to select sources (explicit GRANT missing)';
end $$;

reset role;

-- The finalize functions are SECURITY DEFINER, so they must be called
-- while acting as service_role (matching how PostgREST/the collector
-- actually calls them) to prove the caller-side EXECUTE grant works, even
-- though the function body itself then runs as its owner.
set local role service_role;

do $$
declare
  v_deactivated_count integer;
  v_run_id uuid;
begin
  select id into v_run_id from public.ingestion_runs where source_key = 'test-source' and status = 'running' limit 1;

  select public.finalize_completed_run(
    v_run_id, 'test-source', array['service-role-insert']::text[], 1, 1, 0, 1
  ) into v_deactivated_count;

  -- 'active-1' is not in the seen list, so it should be deactivated;
  -- 'service-role-insert' is in the seen list, so it stays active.
  if not exists (select 1 from public.offers where external_id = 'active-1' and status = 'inactive') then
    raise exception 'FAIL: finalize_completed_run should have deactivated active-1';
  end if;
  if not exists (select 1 from public.offers where external_id = 'service-role-insert' and status = 'active') then
    raise exception 'FAIL: finalize_completed_run should have kept service-role-insert active';
  end if;
  if not exists (select 1 from public.sources where key = 'test-source' and last_success_at is not null) then
    raise exception 'FAIL: finalize_completed_run should have set sources.last_success_at';
  end if;
  if not exists (select 1 from public.ingestion_runs where id = v_run_id and status = 'succeeded' and scan_complete = true) then
    raise exception 'FAIL: finalize_completed_run should have marked the run succeeded';
  end if;
  raise notice 'PASS: finalize_completed_run atomically deactivated missing offers, set source freshness, and finished the run';
end $$;

do $$
declare
  v_run_id uuid;
  v_prior_success timestamptz;
begin
  select last_success_at into v_prior_success from public.sources where key = 'test-source';

  insert into public.ingestion_runs (source_key, status) values ('test-source', 'running') returning id into v_run_id;
  perform public.finalize_failed_run(v_run_id, 'test-source', 'incomplete_scan', 'listing fetch failed: timeout', 0, 0, 0, 0);

  if not exists (select 1 from public.sources where key = 'test-source' and last_error_at is not null) then
    raise exception 'FAIL: finalize_failed_run should have set sources.last_error_at';
  end if;
  if exists (select 1 from public.sources where key = 'test-source' and last_success_at is distinct from v_prior_success) then
    raise exception 'FAIL: finalize_failed_run must never erase sources.last_success_at';
  end if;
  if not exists (select 1 from public.ingestion_runs where id = v_run_id and status = 'failed' and scan_complete = false) then
    raise exception 'FAIL: finalize_failed_run should have marked the run failed';
  end if;
  if exists (select 1 from public.offers where status <> 'active' and external_id = 'service-role-insert') then
    raise exception 'FAIL: finalize_failed_run must never deactivate any offer';
  end if;
  raise notice 'PASS: finalize_failed_run recorded the error and source freshness without touching offer status or last_success_at';
end $$;

reset role;

-- =====================================================================
-- Part 3: canonical-fingerprint duplicate prevention (superuser, since
-- this is a schema-level constraint check, not a privilege check)
-- =====================================================================

do $$
begin
  insert into public.offers (source_key, external_id, source_url, apply_url, canonical_url_hash, title, company, country, language)
  values ('test-source', 'a-different-external-id', 'https://jobs.smartrecruiters.com/TestCo/1-again', 'https://jobs.smartrecruiters.com/TestCo/1-again/apply', 'hash-active-1', 'Stage Developpeur (reposted)', 'TestCo', 'MA', 'fr');
  raise exception 'FAIL: a second external_id with the same canonical_url_hash for the same source should be rejected';
exception
  when unique_violation then
    raise notice 'PASS: the canonical-fingerprint unique constraint rejects a duplicate under a different external_id';
end $$;

-- =====================================================================
-- Part 4: finalize function guards — a run_id that is missing, belongs
-- to a different source, or was already finalized must be rejected
-- BEFORE any mutation. Adversarially confirmed for real before this
-- guard existed: a nonexistent run UUID deactivated an active offer and
-- updated sources.last_success_at.
-- =====================================================================

set local role service_role;

do $$
declare
  v_active_count_before integer;
  v_last_success_before timestamptz;
  v_rejected boolean := false;
begin
  select count(*) into v_active_count_before from public.offers where source_key = 'test-source' and status = 'active';
  select last_success_at into v_last_success_before from public.sources where key = 'test-source';

  begin
    perform public.finalize_completed_run(
      '00000000-0000-0000-0000-000000000000'::uuid, 'test-source', array[]::text[], 0, 0, 0, 0
    );
  exception
    when others then
      v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'FAIL: finalize_completed_run should reject a nonexistent run id';
  end if;
  if (select count(*) from public.offers where source_key = 'test-source' and status = 'active') <> v_active_count_before then
    raise exception 'FAIL: a rejected finalize_completed_run call must never change offer status';
  end if;
  if (select last_success_at from public.sources where key = 'test-source') is distinct from v_last_success_before then
    raise exception 'FAIL: a rejected finalize_completed_run call must never change source freshness';
  end if;
  raise notice 'PASS: finalize_completed_run rejects a nonexistent run id and leaves offers/freshness unchanged';
end $$;

do $$
declare
  v_run_id uuid;
  v_active_count_before integer;
  v_rejected boolean := false;
begin
  insert into public.ingestion_runs (source_key, status) values ('test-source', 'running') returning id into v_run_id;
  select count(*) into v_active_count_before from public.offers where source_key = 'test-source' and status = 'active';

  begin
    -- The run above belongs to 'test-source', not 'wrong-source' — the
    -- (id, source_key, status) match must fail.
    perform public.finalize_completed_run(v_run_id, 'wrong-source', array[]::text[], 0, 0, 0, 0);
  exception
    when others then
      v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'FAIL: finalize_completed_run should reject a run id that belongs to a different source';
  end if;
  if (select count(*) from public.offers where source_key = 'test-source' and status = 'active') <> v_active_count_before then
    raise exception 'FAIL: a rejected wrong-source finalize_completed_run call must never change offer status';
  end if;
  if (select status from public.ingestion_runs where id = v_run_id) <> 'running' then
    raise exception 'FAIL: a rejected wrong-source finalize_completed_run call must leave the run status untouched';
  end if;
  raise notice 'PASS: finalize_completed_run rejects a run id belonging to a different source and leaves offers unchanged';
end $$;

do $$
declare
  v_run_id uuid;
  v_rejected_completed boolean := false;
  v_rejected_failed boolean := false;
begin
  -- The very first ingestion_runs row seeded above is already 'succeeded'.
  select id into v_run_id from public.ingestion_runs where source_key = 'test-source' and status = 'succeeded' limit 1;

  begin
    perform public.finalize_completed_run(v_run_id, 'test-source', array[]::text[], 0, 0, 0, 0);
  exception
    when others then
      v_rejected_completed := true;
  end;
  if not v_rejected_completed then
    raise exception 'FAIL: finalize_completed_run should reject a run that is already finalized';
  end if;

  begin
    perform public.finalize_failed_run(v_run_id, 'test-source', 'x', 'x', 0, 0, 0, 0);
  exception
    when others then
      v_rejected_failed := true;
  end;
  if not v_rejected_failed then
    raise exception 'FAIL: finalize_failed_run should reject a run that is already finalized';
  end if;

  raise notice 'PASS: both finalize functions reject an already-finalized run';
end $$;

-- Isolated fixtures so this null-array assertion doesn't depend on
-- 'test-source' state churned by the assertions above. service_role only
-- has SELECT on sources (see 20260914010700_service_role_grants.sql), so
-- the fixture source itself must be created outside that role.
reset role;

do $$
begin
  insert into public.sources (key, name, adapter, employer_identifier, attribution_url, allowed_hosts, countries)
  values ('test-source-null-array', 'Test Source 2', 'smartrecruiters', 'TestCo2', 'https://jobs.smartrecruiters.com/TestCo2', array['api.smartrecruiters.com'], array['MA']);
  insert into public.offers (source_key, external_id, source_url, apply_url, canonical_url_hash, title, company, country, language, status)
  values ('test-source-null-array', 'n-1', 'https://jobs.smartrecruiters.com/TestCo2/1', 'https://jobs.smartrecruiters.com/TestCo2/1/apply', 'hash-n-1', 'Stage N1', 'TestCo2', 'MA', 'fr', 'active');
end $$;

set local role service_role;

do $$
declare
  v_run_id uuid;
  v_deactivated_count integer;
begin
  insert into public.ingestion_runs (source_key, status) values ('test-source-null-array', 'running') returning id into v_run_id;

  -- A null seen-ID array must behave like "the scan reported nothing" and
  -- must not crash `external_id = any(...)`.
  select public.finalize_completed_run(v_run_id, 'test-source-null-array', null, 0, 0, 0, 0) into v_deactivated_count;

  if v_deactivated_count <> 1 then
    raise exception 'FAIL: finalize_completed_run with a null seen-ID array should deactivate every active offer, deactivated %', v_deactivated_count;
  end if;
  if exists (select 1 from public.offers where source_key = 'test-source-null-array' and status = 'active') then
    raise exception 'FAIL: finalize_completed_run with a null seen-ID array left an offer active';
  end if;
  raise notice 'PASS: finalize_completed_run normalizes a null seen-ID array and deactivates every active offer';
end $$;

reset role;

-- =====================================================================
-- Part 5: cleanup_inactive_offers() — callable only by its documented
-- role, and deletes only what it documents.
-- =====================================================================

do $$
begin
  insert into public.offers (source_key, external_id, source_url, apply_url, canonical_url_hash, title, company, country, language, status, inactive_at)
  values
    ('test-source', 'old-inactive', 'https://jobs.smartrecruiters.com/TestCo/old', 'https://jobs.smartrecruiters.com/TestCo/old/apply', 'hash-old-inactive', 'Stage Old', 'TestCo', 'MA', 'fr', 'inactive', now() - interval '31 days'),
    ('test-source', 'recent-inactive', 'https://jobs.smartrecruiters.com/TestCo/recent', 'https://jobs.smartrecruiters.com/TestCo/recent/apply', 'hash-recent-inactive', 'Stage Recent', 'TestCo', 'MA', 'fr', 'inactive', now() - interval '1 day');
end $$;

set local role anon;

do $$
begin
  perform public.cleanup_inactive_offers();
  raise exception 'FAIL: anon must not be able to call cleanup_inactive_offers';
exception
  when insufficient_privilege then
    raise notice 'PASS: anon cannot call cleanup_inactive_offers';
end $$;

reset role;
set local role authenticated;

do $$
begin
  perform public.cleanup_inactive_offers();
  raise exception 'FAIL: authenticated must not be able to call cleanup_inactive_offers';
exception
  when insufficient_privilege then
    raise notice 'PASS: authenticated cannot call cleanup_inactive_offers';
end $$;

reset role;
set local role service_role;

do $$
declare
  v_deleted_count integer;
begin
  select public.cleanup_inactive_offers() into v_deleted_count;

  if v_deleted_count <> 1 then
    raise exception 'FAIL: cleanup_inactive_offers should have deleted exactly 1 row, deleted %', v_deleted_count;
  end if;
  if exists (select 1 from public.offers where external_id = 'old-inactive') then
    raise exception 'FAIL: cleanup_inactive_offers should have deleted the offer inactive for more than 30 days';
  end if;
  if not exists (select 1 from public.offers where external_id = 'recent-inactive') then
    raise exception 'FAIL: cleanup_inactive_offers must not delete an offer inactive for less than 30 days';
  end if;
  if not exists (select 1 from public.offers where external_id = 'service-role-insert' and status = 'active') then
    raise exception 'FAIL: cleanup_inactive_offers must not delete an active offer';
  end if;
  raise notice 'PASS: service_role can call cleanup_inactive_offers, which deletes only offers inactive for more than 30 days';
exception
  when insufficient_privilege then
    raise exception 'FAIL: service_role should be able to call cleanup_inactive_offers (explicit GRANT missing)';
end $$;

reset role;

-- =====================================================================
-- Part 6: search_offers() — the M3 public search function. Filtering,
-- sorting, keyset pagination stability, and inert handling of
-- injection-shaped input, all called as anon (matching how PostgREST
-- actually invokes it).
-- =====================================================================

do $$
begin
  insert into public.sources (key, name, adapter, employer_identifier, attribution_url, allowed_hosts, countries)
  values ('search-test-source', 'Search Test Source', 'smartrecruiters', 'SearchTestCo', 'https://jobs.smartrecruiters.com/SearchTestCo', array['api.smartrecruiters.com'], array['MA','FR']);

  insert into public.offers (
    source_key, external_id, source_url, apply_url, canonical_url_hash, title, company, city,
    country, language, status, work_mode, is_pfe, specialties, technologies, published_at, first_seen_at, last_seen_at
  ) values
    ('search-test-source', 'search-1', 'https://jobs.smartrecruiters.com/SearchTestCo/1', 'https://jobs.smartrecruiters.com/SearchTestCo/1/apply', 'hash-search-1', 'Stage Développeur React', 'Acme', 'Casablanca', 'MA', 'fr', 'active', 'remote', true, array['software-web-mobile'], array['React'], now() - interval '1 day', now() - interval '1 day', now() - interval '1 day'),
    ('search-test-source', 'search-2', 'https://jobs.smartrecruiters.com/SearchTestCo/2', 'https://jobs.smartrecruiters.com/SearchTestCo/2/apply', 'hash-search-2', 'Stage Data Scientist', 'Beta', 'Paris', 'FR', 'fr', 'active', 'onsite', false, array['data-ai'], array['Python'], now() - interval '2 days', now() - interval '2 days', now() - interval '2 days'),
    -- Same published_at as search-2 (equal-timestamp tiebreak case) but a
    -- lexicographically DIFFERENT id from search-2 — used below to prove
    -- keyset pagination with p_limit=1 visits both exactly once, in a
    -- deterministic order, with no skip/repeat.
    ('search-test-source', 'search-3', 'https://jobs.smartrecruiters.com/SearchTestCo/3', 'https://jobs.smartrecruiters.com/SearchTestCo/3/apply', 'hash-search-3', 'Stage Cybersécurité', 'Gamma', 'Rabat', 'MA', 'fr', 'active', 'hybrid', false, array['cybersecurity'], array[]::text[], now() - interval '2 days', now() - interval '2 days', now() - interval '2 days'),
    ('search-test-source', 'search-inactive', 'https://jobs.smartrecruiters.com/SearchTestCo/4', 'https://jobs.smartrecruiters.com/SearchTestCo/4/apply', 'hash-search-4', 'Stage Inactif', 'Delta', 'Casablanca', 'MA', 'fr', 'inactive', 'unknown', false, array[]::text[], array[]::text[], now() - interval '3 days', now() - interval '3 days', now() - interval '3 days'),
    -- Its title/company/city contain NONE of 'KotlinUnique' — the only
    -- possible match is the technologies array. Reproduces Codex's exact
    -- finding-1 fixture shape.
    ('search-test-source', 'search-5', 'https://jobs.smartrecruiters.com/SearchTestCo/5', 'https://jobs.smartrecruiters.com/SearchTestCo/5/apply', 'hash-search-5', 'Stage Backend', 'Zeta', 'Fes', 'MA', 'fr', 'active', 'unknown', false, array['qa-testing'], array['KotlinUnique'], now() - interval '4 days', now() - interval '4 days', now() - interval '4 days');
end $$;

set local role anon;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.search_offers(null,null,null,null,null,null,null,null,'newest',null,null,10)
    where source_key = 'search-test-source';
  if v_count <> 4 then
    raise exception 'FAIL: search_offers with no filters should return exactly the 4 active fixture offers, saw %', v_count;
  end if;
  if exists (
    select 1 from public.search_offers(null,null,null,null,null,null,null,null,'newest',null,null,10)
    where external_id = 'search-inactive'
  ) then
    raise exception 'FAIL: search_offers must never return an inactive offer';
  end if;
  raise notice 'PASS: search_offers with no filters returns only the active fixture offers';
end $$;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.search_offers('''; drop table offers; --',null,null,null,null,null,null,null,'newest',null,null,10)
  where source_key = 'search-test-source';
  if v_count <> 0 then
    raise exception 'FAIL: an injection-shaped q value should match nothing (treated as inert literal text), saw %', v_count;
  end if;
  -- And prove the table really is still there and unharmed.
  perform 1 from public.offers limit 1;
  raise notice 'PASS: an injection-shaped q value is treated as inert text and the offers table is untouched';
end $$;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.search_offers('react',null,null,null,null,null,null,null,'newest',null,null,10);
  if v_count <> 1 then
    raise exception 'FAIL: q=react should match exactly 1 offer (title), saw %', v_count;
  end if;

  select count(*) into v_count
  from public.search_offers(null,'MA',null,null,null,null,null,null,'newest',null,null,10)
  where source_key = 'search-test-source';
  if v_count <> 3 then
    raise exception 'FAIL: country=MA should match 3 of the 4 fixture offers, saw %', v_count;
  end if;

  select count(*) into v_count
  from public.search_offers(null,null,null,'data-ai',null,null,null,null,'newest',null,null,10);
  if v_count <> 1 then
    raise exception 'FAIL: specialty=data-ai should match exactly 1 offer, saw %', v_count;
  end if;

  select count(*) into v_count
  from public.search_offers(null,null,null,null,'Python',null,null,null,'newest',null,null,10);
  if v_count <> 1 then
    raise exception 'FAIL: technology=Python should match exactly 1 offer, saw %', v_count;
  end if;

  select count(*) into v_count
  from public.search_offers(null,null,null,null,null,'remote',null,null,'newest',null,null,10);
  if v_count <> 1 then
    raise exception 'FAIL: workMode=remote should match exactly 1 offer, saw %', v_count;
  end if;

  select count(*) into v_count
  from public.search_offers(null,null,null,null,null,null,true,null,'newest',null,null,10);
  if v_count <> 1 then
    raise exception 'FAIL: pfe=true should match exactly 1 offer, saw %', v_count;
  end if;

  raise notice 'PASS: each individual filter (q, country, specialty, technology, workMode, pfe) narrows results correctly';
end $$;

do $$
declare
  v_escaped text;
  v_count integer;
begin
  select public.escape_ilike_pattern('50%_off') into v_escaped;
  if v_escaped <> '50\%\_off' then
    raise exception 'FAIL: escape_ilike_pattern should escape %% and _ , got %', v_escaped;
  end if;

  select count(*) into v_count
  from public.search_offers('%',null,null,null,null,null,null,null,'newest',null,null,10)
  where source_key = 'search-test-source';
  if v_count <> 0 then
    raise exception 'FAIL: a literal %% in q must not act as a wildcard matching everything, saw %', v_count;
  end if;

  raise notice 'PASS: escape_ilike_pattern escapes LIKE wildcards and a literal %% in q matches nothing';
end $$;

do $$
declare
  v_first_id uuid;
  v_first_published timestamptz;
  v_second_id uuid;
  v_visited_ids uuid[] := array[]::uuid[];
begin
  -- search-2 and search-3 share the same published_at. Page through them
  -- one at a time (p_limit = 1) using (published_at, id) as the cursor,
  -- and confirm each of the two is visited EXACTLY once, in a
  -- deterministic (id-descending, since published_at ties) order.
  select id, published_at into v_first_id, v_first_published
  from public.search_offers(null,null,null,null,null,null,null,null,'newest',null,null,1)
  where source_key = 'search-test-source' and external_id in ('search-2','search-3')
  limit 1;

  -- The very first call has no cursor at all; re-derive it directly to
  -- avoid relying on ordering across the two fixture rows for anything
  -- other than "some deterministic order exists".
  select id, published_at into v_first_id, v_first_published
  from public.search_offers(null,null,null,null,null,null,null,null,'newest',null,null,10)
  where source_key = 'search-test-source' and external_id in ('search-2','search-3')
  order by published_at desc, id desc
  limit 1;

  v_visited_ids := array_append(v_visited_ids, v_first_id);

  select id into v_second_id
  from public.search_offers(null,null,null,null,null,null,null,null,'newest',v_first_published,v_first_id,1)
  where source_key = 'search-test-source' and external_id in ('search-2','search-3');

  if v_second_id is null then
    raise exception 'FAIL: paging past the first equal-timestamp row should still return the second one';
  end if;
  if v_second_id = v_first_id then
    raise exception 'FAIL: keyset pagination repeated the same row instead of advancing';
  end if;
  v_visited_ids := array_append(v_visited_ids, v_second_id);

  if array_length(v_visited_ids, 1) <> 2 or (v_visited_ids[1] = v_visited_ids[2]) then
    raise exception 'FAIL: expected exactly 2 distinct rows visited across the two pages';
  end if;

  raise notice 'PASS: keyset pagination with equal published_at timestamps visits each row exactly once, in a stable order';
end $$;

-- ---------------------------------------------------------------------
-- Finding 1 (M3 second review): q must also search specialties and
-- technologies, not just title/company/city.
-- ---------------------------------------------------------------------

do $$
declare
  v_count integer;
  v_external_id text;
begin
  -- search-5's title/company/city contain none of 'KotlinUnique' — the
  -- only possible match is the technologies array.
  select count(*), max(external_id) into v_count, v_external_id
  from public.search_offers('KotlinUnique',null,null,null,null,null,null,null,'newest',null,null,10)
  where source_key = 'search-test-source';
  if v_count <> 1 or v_external_id <> 'search-5' then
    raise exception 'FAIL: q=KotlinUnique should match exactly search-5 via the technologies array, saw % row(s), external_id=%', v_count, v_external_id;
  end if;

  -- search-3's title is 'Stage Cybersécurité' (accented, different
  -- spelling) — 'cybersecurity' cannot match via title/company/city, only
  -- via the specialties array containing the literal slug.
  select count(*), max(external_id) into v_count, v_external_id
  from public.search_offers('cybersecurity',null,null,null,null,null,null,null,'newest',null,null,10)
  where source_key = 'search-test-source';
  if v_count <> 1 or v_external_id <> 'search-3' then
    raise exception 'FAIL: q=cybersecurity should match exactly search-3 via the specialties array, saw % row(s), external_id=%', v_count, v_external_id;
  end if;

  raise notice 'PASS: q also searches specialties and technologies (technology-only and specialty-only matches)';
end $$;

-- ---------------------------------------------------------------------
-- Finding 2 (M3 second review): defense-in-depth bounds inside
-- search_offers itself, since anon can call the RPC directly and bypass
-- GET /api/offers's Zod validation entirely. Every case below must
-- degrade safely (no error, no crash, no unbounded/unexpected result) —
-- never raise, since that would itself be a new way to disrupt the
-- endpoint.
-- ---------------------------------------------------------------------

do $$
declare
  v_count integer;
begin
  -- q > 100 chars: truncated safely, not rejected — no error.
  perform count(*) from public.search_offers(repeat('x', 100001),null,null,null,null,null,null,null,'newest',null,null,10);
  -- city > 80 chars: same.
  perform count(*) from public.search_offers(null,null,repeat('y', 500),null,null,null,null,null,'newest',null,null,10);
  -- technology > 40 chars: same.
  perform count(*) from public.search_offers(null,null,null,null,repeat('z', 500),null,null,null,'newest',null,null,10);
  raise notice 'PASS: oversized q/city/technology values are truncated safely without error';
end $$;

do $$
declare
  v_count_all integer;
  v_count_bad_country integer;
  v_count_bad_specialty integer;
  v_count_bad_work_mode integer;
  v_count_bad_language integer;
begin
  select count(*) into v_count_all
  from public.search_offers(null,null,null,null,null,null,null,null,'newest',null,null,10)
  where source_key = 'search-test-source';

  -- An undocumented country/specialty/workMode/language value is dropped
  -- (treated as "no filter on this field") rather than erroring or being
  -- trusted as a literal comparison value.
  select count(*) into v_count_bad_country
  from public.search_offers(null,'XX',null,null,null,null,null,null,'newest',null,null,10)
  where source_key = 'search-test-source';
  select count(*) into v_count_bad_specialty
  from public.search_offers(null,null,null,'not-a-real-slug',null,null,null,null,'newest',null,null,10)
  where source_key = 'search-test-source';
  select count(*) into v_count_bad_work_mode
  from public.search_offers(null,null,null,null,null,'flying',null,null,'newest',null,null,10)
  where source_key = 'search-test-source';
  select count(*) into v_count_bad_language
  from public.search_offers(null,null,null,null,null,null,null,'klingon','newest',null,null,10)
  where source_key = 'search-test-source';

  if v_count_bad_country <> v_count_all or v_count_bad_specialty <> v_count_all
    or v_count_bad_work_mode <> v_count_all or v_count_bad_language <> v_count_all then
    raise exception 'FAIL: an undocumented enum value should be dropped (same result as no filter), got country=%, specialty=%, workMode=%, language=% vs all=%',
      v_count_bad_country, v_count_bad_specialty, v_count_bad_work_mode, v_count_bad_language, v_count_all;
  end if;

  -- An undocumented sort value defaults to 'newest' rather than erroring.
  perform count(*) from public.search_offers(null,null,null,null,null,null,null,null,'oldest-first-nonsense',null,null,10);

  raise notice 'PASS: undocumented country/specialty/workMode/language/sort values are safely dropped/defaulted, never erroring';
end $$;

do $$
declare
  v_count integer;
begin
  -- A raw `limit -5` would error in Postgres ("LIMIT must not be
  -- negative") if not clamped; 0 and a huge value must also behave
  -- safely (clamped to [1, 25], per "the server requests limit + 1" for
  -- a max UI limit of 24).
  select count(*) into v_count from public.search_offers(null,null,null,null,null,null,null,null,'newest',null,null,-5);
  if v_count = 0 then
    raise exception 'FAIL: p_limit=-5 should clamp up to at least 1, not return zero rows unconditionally';
  end if;
  perform count(*) from public.search_offers(null,null,null,null,null,null,null,null,'newest',null,null,0);
  perform count(*) from public.search_offers(null,null,null,null,null,null,null,null,'newest',null,null,1000000);
  raise notice 'PASS: p_limit is safely clamped for negative, zero, and huge values — never a raw Postgres LIMIT error';
end $$;

do $$
declare
  v_count_no_cursor integer;
  v_count_value_only integer;
  v_count_id_only integer;
begin
  select count(*) into v_count_no_cursor
  from public.search_offers(null,null,null,null,null,null,null,null,'newest',null,null,10)
  where source_key = 'search-test-source';

  -- Only p_cursor_value, no p_cursor_id: must be treated as "no cursor"
  -- (page 1), not a half-defined comparison.
  select count(*) into v_count_value_only
  from public.search_offers(null,null,null,null,null,null,null,null,'newest',now(),null,10)
  where source_key = 'search-test-source';
  if v_count_value_only <> v_count_no_cursor then
    raise exception 'FAIL: a cursor value with no id should be treated as no cursor, got % vs % with no cursor', v_count_value_only, v_count_no_cursor;
  end if;

  -- Only p_cursor_id, no p_cursor_value: same.
  select count(*) into v_count_id_only
  from public.search_offers(null,null,null,null,null,null,null,null,'newest',null,'11111111-1111-4111-8111-111111111111'::uuid,10)
  where source_key = 'search-test-source';
  if v_count_id_only <> v_count_no_cursor then
    raise exception 'FAIL: a cursor id with no value should be treated as no cursor, got % vs % with no cursor', v_count_id_only, v_count_no_cursor;
  end if;

  raise notice 'PASS: a half-supplied cursor (value without id, or id without value) is treated as no cursor';
end $$;

reset role;

rollback;
