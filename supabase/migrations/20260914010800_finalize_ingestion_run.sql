-- Replaces a raw PostgREST `not.in.(...)` filter (which required
-- hand-escaping untrusted external_id values into URL/list grammar — a
-- real injection risk if done wrong) with a genuinely parameterized
-- database function: `p_seen_external_ids` travels as a real SQL array
-- parameter, never as interpolated text, so there is no escaping to get
-- wrong. Every run completion — success or failure — goes through one of
-- these two functions, each SECURITY DEFINER with a fixed `search_path`
-- (so it can't be redirected by a caller's search_path) and explicit
-- privilege revocation before granting only to `service_role`.

create or replace function public.finalize_completed_run(
  p_run_id uuid,
  p_source_key text,
  p_seen_external_ids text[],
  p_fetched_count integer,
  p_accepted_count integer,
  p_rejected_count integer,
  p_upserted_count integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deactivated_count integer;
  v_locked_run_id uuid;
  v_seen_ids text[];
  v_row_count integer;
begin
  -- Lock and validate exactly one matching, still-running run BEFORE any
  -- mutation. Without this, a caller-supplied run_id that is missing,
  -- belongs to a different source, or was already finalized would still
  -- deactivate offers and bump source freshness — confirmed for real: a
  -- nonexistent run UUID previously deactivated an active offer and
  -- updated sources.last_success_at. `for update` also serializes
  -- concurrent finalize attempts on the same run.
  select id into v_locked_run_id
  from public.ingestion_runs
  where id = p_run_id
    and source_key = p_source_key
    and status = 'running'
  for update;

  if v_locked_run_id is null then
    raise exception 'ingestion run % for source % is not an in-progress run (missing, wrong source, or already finalized)', p_run_id, p_source_key
      using errcode = 'P0001';
  end if;

  -- A null seen-ID array must behave like "the scan reported nothing",
  -- not crash `= any(...)` (which is NULL, not TRUE/FALSE, for a NULL
  -- array — normalizing first keeps the deactivation predicate correct).
  v_seen_ids := coalesce(p_seen_external_ids, array[]::text[]);

  -- Deactivate every currently-active offer for this source that the
  -- completed scan did not see again. An empty v_seen_ids array
  -- correctly deactivates everything for this source (a genuine "no
  -- postings found" result) — `external_id = any('{}')` is false for
  -- every row, so `not (...)` is true for every row, with no special
  -- case needed.
  update public.offers
  set status = 'inactive', inactive_at = now()
  where source_key = p_source_key
    and status = 'active'
    and not (external_id = any (v_seen_ids));
  get diagnostics v_deactivated_count = row_count;

  update public.sources
  set last_success_at = now()
  where key = p_source_key;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception 'expected exactly one sources row for %, updated %', p_source_key, v_row_count
      using errcode = 'P0001';
  end if;

  update public.ingestion_runs
  set status = 'succeeded',
      scan_complete = true,
      finished_at = now(),
      fetched_count = p_fetched_count,
      accepted_count = p_accepted_count,
      rejected_count = p_rejected_count,
      upserted_count = p_upserted_count,
      deactivated_count = v_deactivated_count,
      error_code = null,
      error_summary = null
  where id = v_locked_run_id
    and source_key = p_source_key;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception 'expected exactly one ingestion_runs row for %, updated %', v_locked_run_id, v_row_count
      using errcode = 'P0001';
  end if;

  return v_deactivated_count;
end;
$$;

comment on function public.finalize_completed_run(uuid, text, text[], integer, integer, integer, integer) is
  'Atomically deactivates offers missing from a completed scan, records source freshness, and finishes the run. service_role only.';

revoke all on function public.finalize_completed_run(uuid, text, text[], integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.finalize_completed_run(uuid, text, text[], integer, integer, integer, integer) to service_role;

create or replace function public.finalize_failed_run(
  p_run_id uuid,
  p_source_key text,
  p_error_code text,
  p_error_summary text,
  p_fetched_count integer,
  p_accepted_count integer,
  p_rejected_count integer,
  p_upserted_count integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked_run_id uuid;
  v_row_count integer;
begin
  -- Same lock-and-validate guard as finalize_completed_run: a failed/partial
  -- run must never touch source freshness or run state for a run that
  -- doesn't exist, belongs to another source, or was already finalized.
  select id into v_locked_run_id
  from public.ingestion_runs
  where id = p_run_id
    and source_key = p_source_key
    and status = 'running'
  for update;

  if v_locked_run_id is null then
    raise exception 'ingestion run % for source % is not an in-progress run (missing, wrong source, or already finalized)', p_run_id, p_source_key
      using errcode = 'P0001';
  end if;

  -- Never touches offers.status: docs/ARCHITECTURE.md — "A failed or
  -- partial scan never changes active state."
  update public.sources
  set last_error_at = now()
  where key = p_source_key;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception 'expected exactly one sources row for %, updated %', p_source_key, v_row_count
      using errcode = 'P0001';
  end if;

  update public.ingestion_runs
  set status = 'failed',
      scan_complete = false,
      finished_at = now(),
      fetched_count = p_fetched_count,
      accepted_count = p_accepted_count,
      rejected_count = p_rejected_count,
      upserted_count = p_upserted_count,
      deactivated_count = 0,
      error_code = p_error_code,
      error_summary = p_error_summary
  where id = v_locked_run_id
    and source_key = p_source_key;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception 'expected exactly one ingestion_runs row for %, updated %', v_locked_run_id, v_row_count
      using errcode = 'P0001';
  end if;
end;
$$;

comment on function public.finalize_failed_run(uuid, text, text, text, integer, integer, integer, integer) is
  'Atomically records a source error timestamp (without erasing last_success_at) and finishes a failed/partial run without deactivating any offer. service_role only.';

revoke all on function public.finalize_failed_run(uuid, text, text, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.finalize_failed_run(uuid, text, text, text, integer, integer, integer, integer) to service_role;
