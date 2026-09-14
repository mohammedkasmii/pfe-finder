-- Explicit, minimum privileges for the ingestion role. Supabase's
-- `service_role` has BYPASSRLS, which skips row-level *policy* checks —
-- it does NOT grant any table privilege. Without these GRANTs, the
-- collector fails with "permission denied for table ..." against any
-- database that doesn't happen to carry a hosted Supabase project's
-- platform-level default grants (confirmed against a plain postgres:17
-- instance). Never GRANT ALL: only what the collector's own code paths
-- actually perform.
--
-- sources: the collector only ever READS `enabled` before scanning.
-- Both `last_success_at` and `last_error_at` are written by the
-- SECURITY DEFINER finalize functions (next migration), which run as
-- their owner — service_role never needs UPDATE on sources directly.
grant select on public.sources to service_role;

-- offers: the collector inserts/updates via upsert directly (this is
-- NOT wrapped in a finalize function, since it needs the full candidate
-- row payload, not just identifiers). SELECT is required too — not just
-- for reading, but because Postgres needs it to evaluate an
-- `ON CONFLICT` target and any `UPDATE ... WHERE` column reference
-- (confirmed against a real Postgres instance: a `insufficient_privilege`
-- error on UPDATE with only INSERT+UPDATE granted, no SELECT). No DELETE
-- is needed — that only ever happens inside SECURITY DEFINER functions,
-- which run as their owner.
grant select, insert, update on public.offers to service_role;

-- ingestion_runs: INSERT to start a run, with SELECT on the returned
-- columns (PostgREST's `.select()`-after-insert uses RETURNING, which
-- needs SELECT privilege on the returned columns). Every run completion
-- — success or failure — goes through a SECURITY DEFINER finalize
-- function, so service_role never needs UPDATE on ingestion_runs
-- directly.
grant select, insert on public.ingestion_runs to service_role;
