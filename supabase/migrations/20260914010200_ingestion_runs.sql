create table public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references public.sources(key),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  scan_complete boolean not null default false,
  fetched_count integer not null default 0,
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  upserted_count integer not null default 0,
  deactivated_count integer not null default 0,
  error_code text,
  error_summary text,

  constraint ingestion_runs_status_valid check (status in ('running','succeeded','failed')),
  constraint ingestion_runs_counts_non_negative check (
    fetched_count >= 0 and accepted_count >= 0 and rejected_count >= 0
    and upserted_count >= 0 and deactivated_count >= 0
  ),
  constraint ingestion_runs_error_summary_bounded check (
    error_summary is null or length(error_summary) <= 500
  ),
  constraint ingestion_runs_finished_after_started check (
    finished_at is null or finished_at >= started_at
  )
);

comment on table public.ingestion_runs is
  'One row per collector attempt per source. Fully internal: never exposed to anon (see the RLS migration). error_summary must never contain credentials, full descriptions, response bodies, or stack traces.';

create index ingestion_runs_source_started_idx
  on public.ingestion_runs (source_key, started_at desc);
