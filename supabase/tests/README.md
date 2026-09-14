# Supabase migration and RLS verification

`rls.sql` in this directory contains executable assertions proving:

- Anonymous clients see only `active` offers, never `inactive` ones.
- Anonymous clients cannot read `ingestion_runs` at all.
- Anonymous clients cannot read `sources.employer_identifier` or
  `sources.allowed_hosts` (internal adapter configuration).
- Anonymous clients cannot `INSERT`, `UPDATE`, or `DELETE` on any table.
- `service_role` (the collector's own credential) CAN insert/update
  offers, insert into `ingestion_runs`, and select `sources` — proving
  BYPASSRLS alone is not enough; the explicit GRANTs in
  `20260914010700_service_role_grants.sql` are what make this work.
- `finalize_completed_run` atomically deactivates offers missing from a
  completed scan, sets `sources.last_success_at`, and marks the run
  succeeded.
- `finalize_failed_run` sets `sources.last_error_at` — without erasing
  `last_success_at` — and marks the run failed, without touching any
  offer's status.
- The `(source_key, canonical_url_hash)` unique constraint rejects a
  second `external_id` claiming a canonical URL another active offer
  already owns.

## Status: verified against a real PostgreSQL 17 instance

This has been run for real, in this development environment, using
Docker (`postgres:17-alpine`) — not just checked structurally. The exact
commands and their results are in `docs/HANDOFF.md`'s newest entry.
Every `NOTICE: PASS: ...` line passed; the script's own `rollback`
leaves no fixture data behind. The seed migration's idempotency (safe to
re-run, and a manual `enabled = false` survives a re-run) was also
verified directly against the same instance.

If a future session doesn't have Docker running, `src/lib/db/*.test.ts`
(the structural tests — `migrations.test.ts`, `rls-policy.test.ts`,
`cleanup-function.test.ts`, `seed-and-grants.test.ts`) still cover what
can be checked from the migration SQL text alone, without a live
database. Re-run the real suite below whenever a migration file changes,
before trusting the structural tests alone again.

## Running it locally

### With the Supabase CLI (recommended for day-to-day development)

```bash
# 1. Start a local Supabase stack (requires Docker Desktop running):
npx supabase start

# 2. Apply every migration in supabase/migrations/, in order:
npx supabase db reset

# 3. Get the local database URL:
npx supabase status
# → look for "DB URL", e.g. postgresql://postgres:postgres@127.0.0.1:54322/postgres

# 4. Run the assertions:
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/rls.sql
```

The Supabase CLI's local stack already provisions the
`anon`/`authenticated`/`service_role` roles, so `bootstrap-roles.sql`
isn't needed in this path.

### With a plain Postgres container (what this repository's own
verification used — no Supabase CLI/full stack required)

```bash
# 1. Start a plain Postgres instance:
docker run -d --name pfe-pg-test -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17-alpine

# 2. Create the anon/authenticated/service_role roles a plain Postgres
#    instance doesn't have out of the box:
docker exec -i pfe-pg-test psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/bootstrap-roles.sql

# 3. Apply every migration, in filename order:
for f in supabase/migrations/*.sql; do
  docker exec -i pfe-pg-test psql -U postgres -v ON_ERROR_STOP=1 < "$f" || break
done

# 4. Run the assertions:
docker exec -i pfe-pg-test psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/rls.sql
```

A clean run prints only `NOTICE:  PASS: ...` lines and exits 0. Any
`ERROR:  FAIL: ...` line (and a non-zero exit code) means an RLS policy,
grant, or constraint regressed — fix the migration, re-apply from a clean
database (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;` on the
plain-Postgres path, or `supabase db reset` on the CLI path), and re-run.

## Running it against Supabase Studio instead of `psql`

If `psql` isn't installed, paste the contents of `rls.sql` into the local
Supabase Studio's SQL editor (`npx supabase status` prints its URL) and run
it there — the `RAISE NOTICE`/`RAISE EXCEPTION` output appears in the
editor's results pane the same way.
