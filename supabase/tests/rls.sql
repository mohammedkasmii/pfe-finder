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

rollback;
