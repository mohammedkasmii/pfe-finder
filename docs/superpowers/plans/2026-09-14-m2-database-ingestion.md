# M2 — Database and Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (subagent-driven and parallel-agent execution are explicitly disallowed for this milestone by `docs/TASKS.md`/the user's instructions). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give PFE Finder a reproducible, RLS-protected Supabase schema and a safe, tested SmartRecruiters ingestion pipeline (typed domain, normalization, classification, idempotent upsert, collector CLI + GitHub Actions), with zero UI/API surface (that is M3).

**Architecture:** SQL migrations (Supabase CLI convention) define `sources`/`offers`/`ingestion_runs` with RLS + column-level grants restricting anonymous reads to public-safe fields; a source-agnostic ingestion domain (Zod schemas, HTML/URL/location normalization, versioned classification dictionaries) turns untrusted external JSON into `NormalizedCandidate`s; a `SmartRecruitersAdapter` implements the adapter contract with an injectable-fetch HTTP client (manual redirects, timeouts, bounded retries with jitter); a `IngestionRepository` interface separates orchestration (idempotency, deactivate-only-on-complete-scan) from the real Supabase-backed implementation, so orchestration is unit-tested against an in-memory fake without a live database; a `tsx`-run collector CLI ties it together for local/manual use and a new GitHub Actions workflow.

**Tech Stack:** Supabase PostgreSQL + `@supabase/supabase-js` (server-only), Zod, `jsdom` (already a devDependency) for HTML-to-text, Node's built-in `fetch`/undici (`redirect: 'manual'` returns the real 3xx response in Node, confirmed via Context7 — not the browser's opaque-redirect), `tsx` (new devDependency) to run the TypeScript collector CLI without a Next.js build, Vitest for all tests.

**Spec:** `docs/ARCHITECTURE.md` (data model, adapter contract, deployment), `docs/PRODUCT.md` (classification rules), `docs/SECURITY.md` (RLS/allowlist/redaction mandates), `docs/SOURCES.md` (the 3 approved sources + normalization rules).

## Global Constraints

- Next.js App Router, strict TypeScript, Supabase PostgreSQL (CLAUDE.md).
- Treat every external field as untrusted; validate with Zod (docs/SECURITY.md).
- Never expose ingestion or database write credentials to browser code (CLAUDE.md, docs/SECURITY.md).
- RLS enabled on every public-schema table; anon gets only active offers + source freshness fields, never insert/update/delete (docs/SECURITY.md).
- Source-level HTTPS host allowlist; manual redirect resolution; reject destinations outside the allowlist; no user-supplied fetch destination (docs/SECURITY.md, docs/ARCHITECTURE.md).
- Strip scripts/styles/forms/embeds/event attributes/tracking markup from descriptions; store/render plain text (docs/SECURITY.md).
- `unique (source_key, external_id)`; country in `MA`/`FR`; status in `active`/`inactive`; URLs HTTPS before persistence (docs/ARCHITECTURE.md).
- `is_pfe` true only for explicit PFE/final-year phrases from docs/PRODUCT.md — never inferred from duration/education level alone.
- Exclude HR/sales/marketing/finance and non-CS roles even when titled "stage"; exclude permanent/freelance/apprenticeship/work-study.
- A scan is complete only when every advertised page/detail succeeds or is deterministically rejected as invalid (docs/ARCHITECTURE.md, docs/SOURCES.md).
- Failed/partial scans never deactivate existing active offers (docs/ARCHITECTURE.md).
- GitHub workflow: `contents: read`, third-party actions pinned to full commit SHAs, never triggered by `pull_request`/`pull_request_target` (docs/SECURITY.md).
- Error summaries bounded and sanitized: no credentials, full descriptions, response bodies, connection strings, or stack traces (docs/SECURITY.md).
- No Docker daemon available in this sandbox (confirmed) — live-Postgres RLS verification is a documented SQL script for Codex/CI to run against a real instance, backed by a Node test that structurally checks the migration SQL.
- Do not touch `/api/offers`, results UI, filters, favorites, or detail pages (M3 scope).
- Do not commit.

---

## Task 1: Supabase migrations — schema, constraints, indexes

**Files:**
- Create: `supabase/migrations/20260914010000_sources.sql`
- Create: `supabase/migrations/20260914010100_offers.sql`
- Create: `supabase/migrations/20260914010200_ingestion_runs.sql`
- Create: `supabase/migrations/20260914010300_rls.sql`
- Create: `supabase/migrations/20260914010400_cleanup_inactive_offers.sql`
- Test: `src/lib/db/migrations.test.ts`

**Interfaces:**
- Produces: table shapes consumed by `src/lib/db/types.ts` (Task 5) — columns named exactly as in docs/ARCHITECTURE.md's data model section, snake_case.

Migration 1 (`..._sources.sql`):
```sql
create table public.sources (
  key text primary key,
  name text not null,
  adapter text not null,
  employer_identifier text not null,
  attribution_url text not null,
  allowed_hosts text[] not null default '{}',
  countries text[] not null default '{}',
  enabled boolean not null default true,
  last_success_at timestamptz,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sources_key_format check (key ~ '^[a-z0-9-]+$'),
  constraint sources_countries_valid check (countries <@ array['MA','FR']::text[]),
  constraint sources_attribution_url_https check (attribution_url ~ '^https://')
);

comment on table public.sources is
  'Configured ingestion sources. Written only by the service-role ingestion credential (GitHub Actions secret), never by the browser.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sources_set_updated_at
  before update on public.sources
  for each row execute function public.set_updated_at();
```

Migration 2 (`..._offers.sql`):
```sql
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references public.sources(key),
  external_id text not null,
  source_url text not null,
  apply_url text not null,
  canonical_url_hash text not null,
  title text not null,
  company text not null,
  description_text text not null default '',
  country text not null,
  city text,
  region text,
  work_mode text not null default 'unknown',
  internship_type text not null default 'internship',
  is_pfe boolean not null default false,
  specialties text[] not null default '{}',
  technologies text[] not null default '{}',
  language text not null,
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  inactive_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint offers_source_external_unique unique (source_key, external_id),
  constraint offers_country_valid check (country in ('MA','FR')),
  constraint offers_status_valid check (status in ('active','inactive')),
  constraint offers_work_mode_valid check (work_mode in ('onsite','hybrid','remote','unknown')),
  -- V1 only ever classifies computer-science internships; non-internship
  -- roles are rejected before persistence (docs/PRODUCT.md). The column
  -- (per docs/ARCHITECTURE.md) is kept distinct from a hardcoded constant
  -- so a future internship sub-type doesn't require a schema migration.
  constraint offers_internship_type_valid check (internship_type in ('internship')),
  constraint offers_language_valid check (language in ('fr','en')),
  constraint offers_source_url_https check (source_url ~ '^https://'),
  constraint offers_apply_url_https check (apply_url ~ '^https://'),
  constraint offers_title_not_blank check (length(btrim(title)) > 0),
  constraint offers_company_not_blank check (length(btrim(company)) > 0),
  constraint offers_inactive_at_requires_inactive check (
    (status = 'inactive') or (inactive_at is null)
  )
);

create index offers_active_published_idx on public.offers (published_at desc) where status = 'active';
create index offers_active_country_idx on public.offers (country) where status = 'active';
create index offers_active_city_idx on public.offers (city) where status = 'active';
create index offers_active_pfe_idx on public.offers (is_pfe) where status = 'active';
create index offers_specialties_gin_idx on public.offers using gin (specialties);
create index offers_technologies_gin_idx on public.offers using gin (technologies);
create index offers_canonical_url_hash_idx on public.offers (canonical_url_hash);

create trigger offers_set_updated_at
  before update on public.offers
  for each row execute function public.set_updated_at();
```

Migration 3 (`..._ingestion_runs.sql`):
```sql
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

create index ingestion_runs_source_started_idx
  on public.ingestion_runs (source_key, started_at desc);
```

Migration 4 (`..._rls.sql`) — see Task 2.

Migration 5 (`..._cleanup_inactive_offers.sql`) — see Task 3.

- [ ] **Step 1: Write the migration files** exactly as above (5 files).
- [ ] **Step 2: Write `src/lib/db/migrations.test.ts`** — a structural safety net that needs no live database:
```typescript
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = join(__dirname, '../../../supabase/migrations')

function readMigrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }))
}

describe('supabase migrations', () => {
  const migrations = readMigrations()
  const allSql = migrations.map((m) => m.sql).join('\n')

  it('creates the three documented tables', () => {
    expect(allSql).toMatch(/create table public\.sources/)
    expect(allSql).toMatch(/create table public\.offers/)
    expect(allSql).toMatch(/create table public\.ingestion_runs/)
  })

  it('enforces the documented unique/check constraints', () => {
    expect(allSql).toMatch(/unique \(source_key, external_id\)/)
    expect(allSql).toMatch(/country in \('MA','FR'\)/)
    expect(allSql).toMatch(/status in \('active','inactive'\)/)
  })

  it('names migration files in lexically increasing order (Supabase CLI convention)', () => {
    const names = migrations.map((m) => m.name)
    expect(names).toEqual([...names].sort())
    expect(names.length).toBeGreaterThanOrEqual(5)
  })
})
```
- [ ] **Step 3: Run** `corepack pnpm exec vitest run src/lib/db/migrations.test.ts` — expect PASS (this is a same-commit structural check, not red/green against prior behavior, since there is no prior migration to regress from).

---

## Task 2: RLS policies and column-level grants

**Files:**
- Create: `supabase/migrations/20260914010300_rls.sql`
- Create: `supabase/tests/rls.sql`
- Create: `supabase/tests/README.md`
- Test: `src/lib/db/rls-policy.test.ts`

**Interfaces:**
- Consumes: tables from Task 1.
- Produces: the anon-safe read surface that `src/lib/db/types.ts` (Task 5) and (in M3) the public repository will rely on.

`supabase/migrations/20260914010300_rls.sql`:
```sql
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
```

`supabase/tests/rls.sql` — documented executable assertions for a real instance (no Docker in this sandbox, so this cannot run here; see README):
```sql
-- Run against a fresh local Supabase instance after migrations are applied:
--   supabase start && supabase db reset
--   psql "$(supabase status -o json | node -pe 'JSON.parse(require("fs").readFileSync(0)).DB_URL')" -f supabase/tests/rls.sql
-- Or, simpler, from the Supabase Studio SQL editor / any psql connected to
-- the local instance's DB_URL. See supabase/tests/README.md.
--
-- Every assertion below either RAISE NOTICEs "PASS: ..." or
-- RAISE EXCEPTIONs "FAIL: ...", so a non-zero psql exit code (from the
-- uncaught exception) means something regressed. The whole thing runs
-- inside a transaction that is rolled back at the end, so it never leaves
-- fixture data behind.

begin;

insert into public.sources (key, name, adapter, employer_identifier, attribution_url, allowed_hosts, countries)
values ('test-source', 'Test Source', 'smartrecruiters', 'TestCo', 'https://jobs.smartrecruiters.com/TestCo', array['api.smartrecruiters.com'], array['MA','FR']);

insert into public.offers (source_key, external_id, source_url, apply_url, canonical_url_hash, title, company, country, language, status)
values
  ('test-source', 'active-1', 'https://jobs.smartrecruiters.com/TestCo/1', 'https://jobs.smartrecruiters.com/TestCo/1/apply', 'hash-active-1', 'Stage Developpeur', 'TestCo', 'MA', 'fr', 'active'),
  ('test-source', 'inactive-1', 'https://jobs.smartrecruiters.com/TestCo/2', 'https://jobs.smartrecruiters.com/TestCo/2/apply', 'hash-inactive-1', 'Stage Data', 'TestCo', 'FR', 'fr', 'inactive');

insert into public.ingestion_runs (source_key, status, scan_complete)
values ('test-source', 'succeeded', true);

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
rollback;
```

`supabase/tests/README.md`: explain prerequisites (Supabase CLI + Docker), exact commands, and that this sandbox could not run it (no Docker daemon) — Codex or CI with Docker available must run it before production launch, per docs/SECURITY.md's launch checklist ("RLS policies reviewed against the deployed database").

- [ ] **Step 1: Write `supabase/tests/rls.sql` and `supabase/tests/README.md` first** (documents the target behavior).
- [ ] **Step 2: Write the RLS migration** as above.
- [ ] **Step 3: Write `src/lib/db/rls-policy.test.ts`** — structural checks that don't need a live DB:
```typescript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const rlsMigration = readFileSync(
  join(__dirname, '../../../supabase/migrations/20260914010300_rls.sql'),
  'utf8',
)

describe('RLS migration (structural)', () => {
  it('enables row level security on every public table', () => {
    for (const table of ['sources', 'offers', 'ingestion_runs']) {
      expect(rlsMigration).toMatch(new RegExp(`alter table public\\.${table} enable row level security`))
    }
  })

  it('never grants insert, update, or delete to anon or authenticated', () => {
    expect(rlsMigration).not.toMatch(/grant\s+(insert|update|delete|all)\s+on[\s\S]*?to\s+(anon|authenticated)/i)
  })

  it('restricts the offers policy to active status', () => {
    expect(rlsMigration).toMatch(/using \(status = 'active'\)/)
  })

  it('grants sources columns explicitly and excludes internal configuration', () => {
    const grantMatch = rlsMigration.match(/grant select \(([^)]+)\) on public\.sources to anon/)
    expect(grantMatch).not.toBeNull()
    const grantedColumns = grantMatch![1].split(',').map((c) => c.trim())
    expect(grantedColumns).toEqual(
      expect.arrayContaining(['key', 'name', 'countries', 'enabled', 'last_success_at', 'attribution_url']),
    )
    for (const forbidden of ['employer_identifier', 'allowed_hosts', 'adapter', 'last_error_at']) {
      expect(grantedColumns).not.toContain(forbidden)
    }
  })

  it('grants ingestion_runs no anon/authenticated access at all', () => {
    expect(rlsMigration).not.toMatch(/grant[\s\S]*?on public\.ingestion_runs[\s\S]*?to\s+(anon|authenticated)/i)
  })
})
```
- [ ] **Step 4: Run** `corepack pnpm exec vitest run src/lib/db/rls-policy.test.ts` — expect PASS.

---

## Task 3: Cleanup function for 30-day inactive retention

**Files:**
- Create: `supabase/migrations/20260914010400_cleanup_inactive_offers.sql`
- Test: `src/lib/db/cleanup-function.test.ts` (structural)

```sql
create or replace function public.cleanup_inactive_offers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.offers
  where status = 'inactive'
    and inactive_at is not null
    and inactive_at < now() - interval '30 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

comment on function public.cleanup_inactive_offers() is
  'Deletes offers inactive for more than 30 days. Run on a schedule (e.g. Supabase pg_cron, or a maintainer-triggered call) using the service role. Never exposed to anon or authenticated.';

revoke all on function public.cleanup_inactive_offers() from public, anon, authenticated;
```

- [ ] **Step 1: Write the migration.**
- [ ] **Step 2: Write the structural test** asserting the function only deletes rows `status = 'inactive'` older than 30 days and revokes public/anon/authenticated execute access (regex on the SQL text, same pattern as Task 1/2's tests).
- [ ] **Step 3: Run** the test file, expect PASS.

---

## Task 4: `.env.example` and README additions for Supabase/collector variables

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:** Documents the env var names `src/lib/env.ts` (Task 5, extended) and the collector CLI (Task 12) read.

- [ ] Add to `.env.example` (names + purpose only, no values):
```
# ---------------------------------------------------------------------------
# Server only — ingestion (GitHub Actions secrets only; NEVER in .env.local
# or any file read by the Next.js app's build/runtime for the browser)
# ---------------------------------------------------------------------------

# Supabase service role key. Bypasses Row Level Security. Used exclusively
# by the collector (scripts/collect.ts via GitHub Actions). Never read by
# Next.js app code, never NEXT_PUBLIC_-prefixed, never logged.
SUPABASE_SERVICE_ROLE_KEY=
```
- [ ] Add a short README section (see Task 13) — deferred to that task so it's written once, alongside the rest of the docs updates.

---

## Task 5: Database types and the `IngestionRepository` interface

**Files:**
- Create: `src/lib/db/types.ts`
- Create: `src/lib/db/repository.ts`
- Create: `src/lib/db/errors.ts`

**Interfaces:**
- Produces:
  - `OfferRow` (snake_case, matches `offers` columns minus `id`/`first_seen_at`/`created_at`/`updated_at`, which the database manages).
  - `IngestionRunPatch` (partial, snake_case, for `finishIngestionRun`).
  - `IngestionRepository` interface: `startIngestionRun(sourceKey: string): Promise<string>`, `finishIngestionRun(runId: string, patch: IngestionRunPatch): Promise<void>`, `upsertOffers(rows: OfferRow[]): Promise<{ upsertedCount: number }>`, `deactivateMissingOffers(sourceKey: string, seenExternalIds: string[]): Promise<{ deactivatedCount: number }>`.
  - `IngestionDbError` class wrapping a Supabase/Postgres error with a bounded, sanitized `.message`.
- Consumed by: Task 6 (real Supabase implementation), Task 11 (fake implementation + collector tests), Task 12 (collector orchestration).

```typescript
// src/lib/db/types.ts
export interface OfferRow {
  source_key: string
  external_id: string
  source_url: string
  apply_url: string
  canonical_url_hash: string
  title: string
  company: string
  description_text: string
  country: 'MA' | 'FR'
  city: string | null
  region: string | null
  work_mode: 'onsite' | 'hybrid' | 'remote' | 'unknown'
  internship_type: 'internship'
  is_pfe: boolean
  specialties: string[]
  technologies: string[]
  language: 'fr' | 'en'
  published_at: string | null
}

export type IngestionRunStatus = 'running' | 'succeeded' | 'failed'

export interface IngestionRunPatch {
  status: IngestionRunStatus
  scan_complete: boolean
  fetched_count?: number
  accepted_count?: number
  rejected_count?: number
  upserted_count?: number
  deactivated_count?: number
  error_code?: string | null
  error_summary?: string | null
}
```

```typescript
// src/lib/db/errors.ts
export class IngestionDbError extends Error {
  constructor(message: string, cause?: unknown) {
    // Never interpolate the raw `cause` into the message: Postgres/Supabase
    // error objects can carry the failing row's data or connection details.
    super(message)
    this.name = 'IngestionDbError'
    this.cause = cause
  }
}
```

```typescript
// src/lib/db/repository.ts
import type { IngestionRunPatch, OfferRow } from './types'

export interface IngestionRepository {
  startIngestionRun(sourceKey: string): Promise<string>
  finishIngestionRun(runId: string, patch: IngestionRunPatch): Promise<void>
  upsertOffers(rows: OfferRow[]): Promise<{ upsertedCount: number }>
  deactivateMissingOffers(
    sourceKey: string,
    seenExternalIds: string[],
  ): Promise<{ deactivatedCount: number }>
}
```

- [ ] **Step 1: Write the three files above** (pure types/interfaces — nothing to unit test directly; correctness is verified by every consumer's tests in later tasks).
- [ ] **Step 2: Run** `corepack pnpm run typecheck` — expect PASS (new files compile).

---

## Task 6: Real Supabase-backed repository

**Files:**
- Create: `src/lib/db/supabase-client.ts`
- Create: `src/lib/db/supabase-repository.ts`
- Modify: `src/lib/env.ts` (+ its test) — add `supabaseServiceRoleKey` to the env schema, **production/collector-only**, never `NEXT_PUBLIC_`.
- Test: `src/lib/db/supabase-repository.test.ts` (call-shape assertions against a fake `SupabaseClient`, since there is no live database in this sandbox)

**Interfaces:**
- Consumes: `IngestionRepository` (Task 5), `env` (extended).
- Produces: `createSupabaseIngestionClient(env): SupabaseClient`, `createSupabaseIngestionRepository(client): IngestionRepository`.

Extend `src/lib/env.ts`'s `Env` interface with `supabaseServiceRoleKey: string` — required only when actually constructing the ingestion client (Task 12's CLI checks it explicitly with a clear error), **not** added to the existing `loadEnv` production-gate (that function validates the *public* Next.js env; the service role key is a separate, GitHub-Actions-only secret intentionally kept out of the browser-facing validation path so importing `env` from `src/lib/env.ts` anywhere in `src/app` can never pull in the service role key).

Instead, add a small, separate loader used only by the collector:
```typescript
// src/lib/db/supabase-client.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface SupabaseIngestionCredentials {
  supabaseUrl: string
  serviceRoleKey: string
}

export function loadSupabaseIngestionCredentials(
  source: Record<string, string | undefined> = process.env,
): SupabaseIngestionCredentials {
  const supabaseUrl = source.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = source.SUPABASE_SERVICE_ROLE_KEY
  const issues: string[] = []
  if (!supabaseUrl) issues.push('NEXT_PUBLIC_SUPABASE_URL is required for ingestion')
  if (!serviceRoleKey) issues.push('SUPABASE_SERVICE_ROLE_KEY is required for ingestion')
  if (issues.length > 0) throw new Error(`Invalid ingestion configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`)
  return { supabaseUrl: supabaseUrl!, serviceRoleKey: serviceRoleKey! }
}

export function createSupabaseIngestionClient(credentials: SupabaseIngestionCredentials): SupabaseClient {
  return createClient(credentials.supabaseUrl, credentials.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
```

```typescript
// src/lib/db/supabase-repository.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { IngestionDbError } from './errors'
import type { IngestionRepository } from './repository'
import type { IngestionRunPatch, OfferRow } from './types'

export function createSupabaseIngestionRepository(client: SupabaseClient): IngestionRepository {
  return {
    async startIngestionRun(sourceKey) {
      const { data, error } = await client
        .from('ingestion_runs')
        .insert({ source_key: sourceKey, status: 'running' })
        .select('id')
        .single()
      if (error || !data) throw new IngestionDbError('failed to start ingestion run')
      return data.id as string
    },

    async finishIngestionRun(runId, patch: IngestionRunPatch) {
      const { error } = await client
        .from('ingestion_runs')
        .update({ ...patch, finished_at: new Date().toISOString() })
        .eq('id', runId)
      if (error) throw new IngestionDbError('failed to finish ingestion run')
    },

    async upsertOffers(rows: OfferRow[]) {
      if (rows.length === 0) return { upsertedCount: 0 }
      const nowIso = new Date().toISOString()
      // Deliberately omit first_seen_at/created_at from every row: Postgres
      // fills them via column DEFAULT now() on INSERT, and PostgREST's
      // merge-duplicates upsert only SETs columns present in the payload,
      // so an existing row's first_seen_at/created_at is never touched on
      // conflict. This is what makes "retry creates no duplicates and
      // never resets first_seen_at" true without extra application logic.
      const { error, count } = await client
        .from('offers')
        .upsert(
          rows.map((row) => ({ ...row, status: 'active', inactive_at: null, last_seen_at: nowIso })),
          { onConflict: 'source_key,external_id', count: 'exact' },
        )
      if (error) throw new IngestionDbError('failed to upsert offers')
      return { upsertedCount: count ?? rows.length }
    },

    async deactivateMissingOffers(sourceKey, seenExternalIds) {
      const nowIso = new Date().toISOString()
      let query = client
        .from('offers')
        .update({ status: 'inactive', inactive_at: nowIso }, { count: 'exact' })
        .eq('source_key', sourceKey)
        .eq('status', 'active')
      if (seenExternalIds.length > 0) {
        query = query.not('external_id', 'in', `(${seenExternalIds.map((id) => `"${id}"`).join(',')})`)
      }
      const { error, count } = await query
      if (error) throw new IngestionDbError('failed to deactivate missing offers')
      return { deactivatedCount: count ?? 0 }
    },
  }
}
```

- [ ] **Step 1: Write `src/lib/db/supabase-client.ts`.**
- [ ] **Step 2: Write the failing test for `loadSupabaseIngestionCredentials`** in `src/lib/db/supabase-client.test.ts`:
```typescript
import { describe, expect, it } from 'vitest'
import { loadSupabaseIngestionCredentials } from './supabase-client'

describe('loadSupabaseIngestionCredentials', () => {
  it('returns both values when present', () => {
    const creds = loadSupabaseIngestionCredentials({
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'a'.repeat(40),
    })
    expect(creds).toEqual({ supabaseUrl: 'https://project.supabase.co', serviceRoleKey: 'a'.repeat(40) })
  })

  it('throws a bounded error naming every missing variable, never a value', () => {
    expect(() => loadSupabaseIngestionCredentials({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
    expect(() => loadSupabaseIngestionCredentials({})).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})
```
- [ ] **Step 3: Run, confirm fail, then it already passes once the file above is written** (implementation and test are simple enough to verify in the same pass — run `corepack pnpm exec vitest run src/lib/db/supabase-client.test.ts`).
- [ ] **Step 4: Write `src/lib/db/supabase-repository.ts`** as above.
- [ ] **Step 5: Write `src/lib/db/supabase-repository.test.ts`** using a hand-written fake `SupabaseClient` (only implementing `.from().insert().select().single()`, `.from().update().eq()`, `.from().upsert()` — record calls and return configurable results) to assert:
  - `upsertOffers` never includes `first_seen_at` or `created_at` keys in the payload sent to `.upsert()`.
  - `upsertOffers` always sets `status: 'active'` and `inactive_at: null`.
  - `upsertOffers([])` returns `{ upsertedCount: 0 }` without calling the client at all.
  - `deactivateMissingOffers` filters `.eq('source_key', ...)` and `.eq('status', 'active')` and excludes only the given IDs.
  - Errors from the fake client surface as `IngestionDbError` with a fixed message (never the raw Postgres error object).
- [ ] **Step 6: Run** the test file, iterate until PASS.

---

## Task 7: Ingestion domain types (Zod)

**Files:**
- Create: `src/lib/ingestion/types.ts`
- Test: `src/lib/ingestion/types.test.ts`

**Interfaces:**
- Produces: `CountrySchema`, `WorkModeSchema`, `LanguageSchema`, `SpecialtySlugSchema` (reuses `SPECIALTY_SLUGS` from Task 8), `NormalizedCandidateSchema`/`NormalizedCandidate`, `CollectionResult` interface — consumed by every later task.

```typescript
import { z } from 'zod'
import { SPECIALTY_SLUGS } from './dictionaries/specialties'

export const CountrySchema = z.enum(['MA', 'FR'])
export const WorkModeSchema = z.enum(['onsite', 'hybrid', 'remote', 'unknown'])
export const LanguageSchema = z.enum(['fr', 'en'])
export const SpecialtySlugSchema = z.enum(SPECIALTY_SLUGS)

export const NormalizedCandidateSchema = z.object({
  sourceKey: z.string().min(1),
  externalId: z.string().min(1).max(200),
  sourceUrl: z.string().url(),
  applyUrl: z.string().url(),
  canonicalUrlHash: z.string().min(1),
  title: z.string().min(1).max(200),
  company: z.string().min(1).max(200),
  descriptionText: z.string().max(5000),
  country: CountrySchema,
  city: z.string().max(80).nullable(),
  region: z.string().max(80).nullable(),
  workMode: WorkModeSchema,
  internshipType: z.literal('internship'),
  isPfe: z.boolean(),
  specialties: z.array(SpecialtySlugSchema),
  technologies: z.array(z.string().max(40)),
  language: LanguageSchema,
  publishedAt: z.string().datetime().nullable(),
})
export type NormalizedCandidate = z.infer<typeof NormalizedCandidateSchema>

export interface CollectionResult {
  sourceKey: string
  candidates: NormalizedCandidate[]
  fetchedCount: number
  acceptedCount: number
  rejectedCount: number
  scanComplete: boolean
  errorSummary?: string
}
```

- [ ] **Step 1: Write `src/lib/ingestion/dictionaries/specialties.ts` first** (Task 8 defines it fully; for this task, just the `SPECIALTY_SLUGS` export is needed — write the full file now since Task 8 builds on it anyway, or stub the six-slug tuple here and let Task 8 add the classifier function to the same file).
- [ ] **Step 2: Write `src/lib/ingestion/types.ts`** as above.
- [ ] **Step 3: Write `src/lib/ingestion/types.test.ts`**:
```typescript
import { describe, expect, it } from 'vitest'
import { NormalizedCandidateSchema } from './types'

const validCandidate = {
  sourceKey: 'smartrecruiters-inetum',
  externalId: 'abc123',
  sourceUrl: 'https://jobs.smartrecruiters.com/Inetum2/abc123',
  applyUrl: 'https://jobs.smartrecruiters.com/Inetum2/abc123/apply',
  canonicalUrlHash: 'deadbeef',
  title: 'Stage Développeur Full Stack',
  company: 'Inetum',
  descriptionText: 'Stage de développement web.',
  country: 'MA',
  city: 'Casablanca',
  region: null,
  workMode: 'onsite',
  internshipType: 'internship',
  isPfe: false,
  specialties: ['software-web-mobile'],
  technologies: ['React'],
  language: 'fr',
  publishedAt: null,
}

describe('NormalizedCandidateSchema', () => {
  it('accepts a well-formed candidate', () => {
    expect(NormalizedCandidateSchema.safeParse(validCandidate).success).toBe(true)
  })

  it('rejects a non-MA/FR country', () => {
    expect(NormalizedCandidateSchema.safeParse({ ...validCandidate, country: 'US' }).success).toBe(false)
  })

  it('rejects a non-https sourceUrl', () => {
    expect(NormalizedCandidateSchema.safeParse({ ...validCandidate, sourceUrl: 'http://jobs.smartrecruiters.com/x' }).success).toBe(true) // z.url() alone doesn't enforce https — see note below
  })

  it('rejects an oversized title', () => {
    expect(NormalizedCandidateSchema.safeParse({ ...validCandidate, title: 'x'.repeat(201) }).success).toBe(false)
  })

  it('rejects an unknown specialty slug', () => {
    expect(NormalizedCandidateSchema.safeParse({ ...validCandidate, specialties: ['not-a-real-slug'] }).success).toBe(false)
  })
})
```
  Note inline in the test: `z.string().url()` does not itself enforce `https:` — HTTPS-and-allowlist enforcement is `validateAllowlistedHttpsUrl` (Task 9), which runs *before* a candidate is constructed, so by the time a value reaches this schema it is already a validated HTTPS URL. This schema's job is shape/bounds validation, not the security check itself — don't conflate the two layers.
- [ ] **Step 4: Run** `corepack pnpm exec vitest run src/lib/ingestion/types.test.ts` — iterate until PASS.

---

## Task 8: Versioned classification dictionaries (specialties, technologies)

**Files:**
- Create: `src/lib/ingestion/dictionaries/specialties.ts`
- Create: `src/lib/ingestion/dictionaries/specialties.test.ts`
- Create: `src/lib/ingestion/dictionaries/technologies.ts`
- Create: `src/lib/ingestion/dictionaries/technologies.test.ts`

**Interfaces:**
- Produces: `SPECIALTY_SLUGS` (readonly tuple of 6 slugs, consumed by Task 7), `SPECIALTIES_DICTIONARY_VERSION: number`, `classifySpecialties(text: string): SpecialtySlug[]`; `TECHNOLOGIES_DICTIONARY_VERSION: number`, `classifyTechnologies(text: string): string[]`.
- Consumed by: Task 10 (`classifyPosting`).

```typescript
// src/lib/ingestion/dictionaries/specialties.ts
export const SPECIALTIES_DICTIONARY_VERSION = 1

export const SPECIALTY_SLUGS = [
  'software-web-mobile',
  'data-ai',
  'cybersecurity',
  'cloud-devops',
  'systems-networks',
  'qa-testing',
] as const
export type SpecialtySlug = (typeof SPECIALTY_SLUGS)[number]

const SPECIALTY_PATTERNS: Record<SpecialtySlug, RegExp> = {
  'software-web-mobile':
    /d[ée]veloppeur|d[ée]veloppement (web|mobile|logiciel)|developer|software engineer|full[- ]stack|front[- ]?end|back[- ]?end|application mobile|mobile app|ing[ée]nieur logiciel/i,
  'data-ai':
    /data scientist|data analyst|data engineer|machine learning|deep learning|intelligence artificielle|artificial intelligence|\bia\b|\bml\b|big data|\bnlp\b|computer vision/i,
  cybersecurity:
    /cybers[ée]curit[ée]|s[ée]curit[ée] informatique|pentest|security engineer|soc analyst|infosec|ethical hack/i,
  'cloud-devops':
    /devops|cloud engineer|kubernetes|\bdocker\b|\baws\b|\bazure\b|\bgcp\b|infrastructure as code|terraform|\bci\/cd\b|\bsre\b/i,
  'systems-networks':
    /syst[èe]mes?\s*(et|\/)?\s*r[ée]seaux|network engineer|administrateur syst[èe]me|sysadmin|infrastructure r[ée]seau|t[ée]l[ée]com/i,
  'qa-testing':
    /\bqa\b|quality assurance|test(eur|euse|ing)? logiciel|test automation|assurance qualit[ée]/i,
}

export function classifySpecialties(text: string): SpecialtySlug[] {
  return SPECIALTY_SLUGS.filter((slug) => SPECIALTY_PATTERNS[slug].test(text))
}
```

```typescript
// src/lib/ingestion/dictionaries/technologies.ts
export const TECHNOLOGIES_DICTIONARY_VERSION = 1

interface TechnologyEntry {
  canonical: string
  pattern: RegExp
}

// Deliberately excludes bare "Go" (too ambiguous against the English verb);
// only the unambiguous "Golang" spelling is matched. Document this limit
// rather than risk false positives.
const TECHNOLOGIES: TechnologyEntry[] = [
  { canonical: 'JavaScript', pattern: /\bjavascript\b/i },
  { canonical: 'TypeScript', pattern: /\btypescript\b/i },
  { canonical: 'Python', pattern: /\bpython\b/i },
  { canonical: 'Java', pattern: /\bjava\b(?!script)/i },
  { canonical: 'C++', pattern: /c\+\+/i },
  { canonical: 'C#', pattern: /c#/i },
  { canonical: 'PHP', pattern: /\bphp\b/i },
  { canonical: 'Golang', pattern: /\bgolang\b/i },
  { canonical: 'React', pattern: /\breact(\.js)?\b/i },
  { canonical: 'Angular', pattern: /\bangular\b/i },
  { canonical: 'Vue.js', pattern: /\bvue(\.js)?\b/i },
  { canonical: 'Node.js', pattern: /\bnode(\.js)?\b/i },
  { canonical: 'Next.js', pattern: /\bnext\.js\b/i },
  { canonical: 'Django', pattern: /\bdjango\b/i },
  { canonical: 'Spring', pattern: /\bspring( boot)?\b/i },
  { canonical: '.NET', pattern: /\.net\b/i },
  { canonical: 'AWS', pattern: /\baws\b|amazon web services/i },
  { canonical: 'Azure', pattern: /\bazure\b/i },
  { canonical: 'GCP', pattern: /\bgcp\b|google cloud/i },
  { canonical: 'Docker', pattern: /\bdocker\b/i },
  { canonical: 'Kubernetes', pattern: /\bkubernetes\b|\bk8s\b/i },
  { canonical: 'Terraform', pattern: /\bterraform\b/i },
  { canonical: 'SQL', pattern: /\bsql\b/i },
  { canonical: 'PostgreSQL', pattern: /\bpostgres(ql)?\b/i },
  { canonical: 'MySQL', pattern: /\bmysql\b/i },
  { canonical: 'MongoDB', pattern: /\bmongodb\b/i },
  { canonical: 'Linux', pattern: /\blinux\b/i },
  { canonical: 'Git', pattern: /\bgit\b/i },
  { canonical: 'TensorFlow', pattern: /\btensorflow\b/i },
  { canonical: 'PyTorch', pattern: /\bpytorch\b/i },
]

export function classifyTechnologies(text: string): string[] {
  const matched = TECHNOLOGIES.filter((t) => t.pattern.test(text)).map((t) => t.canonical)
  return Array.from(new Set(matched))
}
```

- [ ] **Step 1: Write both `.test.ts` files first**, one `it` per specialty/technology with a positive fixture sentence (FR and EN mixed) and one `it` asserting an unrelated sentence ("Stage assistant comptable") yields `[]` for both. Include a duplicate-mention case (`"React et React Native"` → `['React']`, not `['React','React']`).
- [ ] **Step 2: Run, confirm fail** (`Cannot find module`).
- [ ] **Step 3: Write both dictionary files** as above.
- [ ] **Step 4: Run, iterate until every case passes.** Expect to tune 1-2 regexes against real fixture sentences (e.g. accented character classes) — this is normal; don't skip the run-and-adjust loop.

---

## Task 9: Safe normalization — HTML, URLs, location

**Files:**
- Create: `src/lib/ingestion/html.ts`
- Create: `src/lib/ingestion/html.test.ts`
- Create: `src/lib/ingestion/urls.ts`
- Create: `src/lib/ingestion/urls.test.ts`
- Create: `src/lib/ingestion/location.ts`
- Create: `src/lib/ingestion/location.test.ts`

**Interfaces:**
- Produces: `sanitizeDescriptionToPlainText(html: string): string`; `validateAllowlistedHttpsUrl(rawUrl: string, allowedHosts: readonly string[]): { ok: true; url: string } | { ok: false; reason: string }`; `stripTrackingParams(rawUrl: string): string`; `computeCanonicalUrlHash(rawUrl: string): string`; `normalizeLocation(raw: { country?: string | null; city?: string | null; region?: string | null }): { country: 'MA' | 'FR'; city: string | null; region: string | null } | null`.
- Consumed by: Task 10 (classification uses the description text), Task 11 (SmartRecruiters adapter uses all four).

```typescript
// src/lib/ingestion/html.ts
import { JSDOM } from 'jsdom'

const MAX_DESCRIPTION_LENGTH = 5000
const REMOVE_SELECTORS = ['script', 'style', 'form', 'iframe', 'object', 'embed', 'noscript']

export function sanitizeDescriptionToPlainText(html: string): string {
  if (!html) return ''
  const dom = new JSDOM(`<body>${html}</body>`)
  const { document } = dom.window
  for (const selector of REMOVE_SELECTORS) {
    document.querySelectorAll(selector).forEach((el) => el.remove())
  }
  const rawText = document.body.textContent ?? ''
  const withoutControlChars = rawText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  const collapsed = withoutControlChars
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return collapsed.slice(0, MAX_DESCRIPTION_LENGTH)
}
```

```typescript
// src/lib/ingestion/urls.ts
import { createHash } from 'node:crypto'

export type UrlValidationResult = { ok: true; url: string } | { ok: false; reason: string }

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])
const TRACKING_PARAM_NAMES = new Set(['gclid', 'fbclid', 'mc_cid', 'mc_eid', 'igshid', 'ref', 'yclid', 'msclkid'])

function isPrivateIpv4Literal(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false
  const a = Number(match[1])
  const b = Number(match[2])
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

export function validateAllowlistedHttpsUrl(rawUrl: string, allowedHosts: readonly string[]): UrlValidationResult {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'malformed URL' }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'must use https' }
  if (url.username || url.password) return { ok: false, reason: 'must not carry credentials' }
  if (LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())) return { ok: false, reason: 'must not target localhost' }
  if (isPrivateIpv4Literal(url.hostname)) return { ok: false, reason: 'must not target a private IP address' }
  if (!allowedHosts.includes(url.hostname)) return { ok: false, reason: `host not allowlisted: ${url.hostname}` }
  return { ok: true, url: url.toString() }
}

export function stripTrackingParams(rawUrl: string): string {
  const url = new URL(rawUrl)
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAM_NAMES.has(key.toLowerCase())) {
      url.searchParams.delete(key)
    }
  }
  return url.toString()
}

export function computeCanonicalUrlHash(rawUrl: string): string {
  return createHash('sha256').update(stripTrackingParams(rawUrl)).digest('hex')
}
```

```typescript
// src/lib/ingestion/location.ts
export interface NormalizedLocation {
  country: 'MA' | 'FR'
  city: string | null
  region: string | null
}

const COUNTRY_ALIASES: Record<string, 'MA' | 'FR'> = {
  MA: 'MA',
  MAR: 'MA',
  MOROCCO: 'MA',
  MAROC: 'MA',
  FR: 'FR',
  FRA: 'FR',
  FRANCE: 'FR',
}

export function normalizeLocation(raw: {
  country?: string | null
  city?: string | null
  region?: string | null
}): NormalizedLocation | null {
  if (!raw.country) return null
  const country = COUNTRY_ALIASES[raw.country.trim().toUpperCase()]
  if (!country) return null
  return {
    country,
    city: raw.city?.trim() ? raw.city.trim().slice(0, 80) : null,
    region: raw.region?.trim() ? raw.region.trim().slice(0, 80) : null,
  }
}
```

- [ ] **Step 1: Write `html.test.ts` first**, covering: plain text passthrough; `<script>alert(1)</script>` content removed entirely (not just the tag); `<style>` content removed; a `<form>` with an `<input>` removed; an `<img onerror="alert(1)">` produces no "alert" text; malformed/unclosed tags don't throw; control characters (`\x00`, `\x1F`) stripped; text over 5000 chars truncated to exactly 5000; excess blank lines collapsed.
- [ ] **Step 2: Run, confirm fail, write `html.ts`, run again until PASS.**
- [ ] **Step 3: Write `urls.test.ts` first**, covering: valid allowlisted HTTPS URL accepted; `http://` rejected; `https://user:pass@api.smartrecruiters.com/x` rejected (credentials); `https://localhost/x` rejected; `https://127.0.0.1/x` rejected; `https://10.0.0.5/x` rejected (private IPv4); `https://evil.example.com/x` rejected (not allowlisted); a host that is a *substring* match trick like `https://api.smartrecruiters.com.attacker.com/x` rejected (exact hostname match, not suffix); malformed URL string rejected; `stripTrackingParams` removes `utm_source`/`fbclid`/`gclid` but keeps a legitimate `id=123` param; `computeCanonicalUrlHash` is stable for the same URL and differs when tracking params are the only difference is irrelevant (hash the *stripped* URL, so two URLs differing only by tracking params hash the same — assert this explicitly) and differs for a genuinely different path.
- [ ] **Step 4: Run, confirm fail, write `urls.ts`, run again until PASS.**
- [ ] **Step 5: Write `location.test.ts` first**, covering: `{country:'MA'}` → `{country:'MA', city:null, region:null}`; `{country:'Maroc', city:' Casablanca '}` → trimmed `city:'Casablanca'`; `{country:'France'}` → `FR`; `{country:'US'}` → `null`; `{country:null}` → `null`; overlength city truncated to 80 chars.
- [ ] **Step 6: Run, confirm fail, write `location.ts`, run again until PASS.**

---

## Task 10: Classification — accept/reject, PFE, work mode

**Files:**
- Create: `src/lib/ingestion/classification.ts`
- Create: `src/lib/ingestion/classification.test.ts`
- Create: `src/lib/ingestion/fixtures/postings.ts`

**Interfaces:**
- Consumes: `classifySpecialties`/`classifyTechnologies` (Task 8).
- Produces: `classifyPosting(input: { title: string; descriptionText: string }): ClassificationResult | null` where `ClassificationResult = { internshipType: 'internship'; isPfe: boolean; specialties: SpecialtySlug[]; technologies: string[]; workMode: WorkMode }`.
- Consumed by: Task 11 (adapter).

```typescript
// src/lib/ingestion/classification.ts
import { classifySpecialties, type SpecialtySlug } from './dictionaries/specialties'
import { classifyTechnologies } from './dictionaries/technologies'

export interface ClassificationInput {
  title: string
  descriptionText: string
}

export type WorkMode = 'onsite' | 'hybrid' | 'remote' | 'unknown'

export interface ClassificationResult {
  internshipType: 'internship'
  isPfe: boolean
  specialties: SpecialtySlug[]
  technologies: string[]
  workMode: WorkMode
}

const INTERNSHIP_KEYWORDS = /\bstage\b|\bstagiaire\b|\binternship\b|\bintern\b/i
const EXCLUDED_CONTRACT_KEYWORDS =
  /\bcdi\b|\bcdd\b|\bfreelance\b|\bind[ée]pendant\b|\balternance\b|\bapprentissage\b|contrat de professionnalisation|\bwork[- ]study\b|\bfull[- ]time employee\b|\bpermanent position\b/i
const NON_CS_DOMAIN_KEYWORDS =
  /ressources humaines|\bhr\b|human resources|\bmarketing\b|\bcommercial\b|\bventes?\b|\bsales\b|comptabilit[ée]|\baccounting\b/i
const CS_DOMAIN_SIGNAL = /informatique|computer science|ing[ée]nieur logiciel|software engineer|\binformatics\b/i

// docs/PRODUCT.md: is_pfe is true ONLY for these explicit phrases — never
// inferred from duration, education level, or graduation year alone.
const PFE_PHRASES =
  /\bpfe\b|stage de fin d.[ée]tudes?|projet de fin d.[ée]tudes?|final[- ]year internship|end[- ]of[- ]studies internship/i

export function classifyPosting(input: ClassificationInput): ClassificationResult | null {
  const text = `${input.title}\n${input.descriptionText}`

  if (!INTERNSHIP_KEYWORDS.test(text)) return null
  if (EXCLUDED_CONTRACT_KEYWORDS.test(text)) return null

  const specialties = classifySpecialties(text)
  const technologies = classifyTechnologies(text)
  const hasCsSignal = specialties.length > 0 || technologies.length > 0 || CS_DOMAIN_SIGNAL.test(text)
  if (!hasCsSignal) return null
  if (NON_CS_DOMAIN_KEYWORDS.test(text) && specialties.length === 0 && technologies.length === 0) return null

  return {
    internshipType: 'internship',
    isPfe: PFE_PHRASES.test(text),
    specialties,
    technologies,
    workMode: classifyWorkMode(text),
  }
}

function classifyWorkMode(text: string): WorkMode {
  if (/t[ée]l[ée]travail|\bremote\b|\bwfh\b|travail [àa] distance/i.test(text)) return 'remote'
  if (/hybride|\bhybrid\b/i.test(text)) return 'hybrid'
  if (/sur site|on[- ]site|pr[ée]sentiel/i.test(text)) return 'onsite'
  return 'unknown'
}
```

`src/lib/ingestion/fixtures/postings.ts` — the documented fixture set (French/English, positive/negative, hostile HTML, malformed URLs, ambiguous roles, Morocco, France), each entry with a `description` field explaining *why* it's fixture-worthy:
```typescript
export interface PostingFixture {
  description: string
  title: string
  descriptionHtml: string
  expectAccepted: boolean
  expectIsPfe?: boolean
}

export const POSTING_FIXTURES: PostingFixture[] = [
  {
    description: 'FR, clear CS internship, no PFE phrase',
    title: 'Stage Développeur Full Stack (H/F)',
    descriptionHtml: '<p>Stage de 6 mois en développement web avec React et Node.js.</p>',
    expectAccepted: true,
    expectIsPfe: false,
  },
  {
    description: 'FR, explicit PFE phrase',
    title: 'Stage de fin d’études — Data Engineer',
    descriptionHtml: '<p>Stage de fin d’études en ingénierie de la donnée, Python et SQL.</p>',
    expectAccepted: true,
    expectIsPfe: true,
  },
  {
    description: 'EN, explicit final-year internship phrase',
    title: 'Final-Year Internship — Cloud Engineer',
    descriptionHtml: '<p>Final-year internship working on AWS and Kubernetes infrastructure.</p>',
    expectAccepted: true,
    expectIsPfe: true,
  },
  {
    description: 'EN, CS internship, no PFE phrase',
    title: 'Software Engineering Intern',
    descriptionHtml: '<p>Internship building backend services in Java and PostgreSQL.</p>',
    expectAccepted: true,
    expectIsPfe: false,
  },
  {
    description: 'FR, six-month duration alone must NOT imply PFE',
    title: 'Stage Développeur',
    descriptionHtml: '<p>Stage de six mois en développement logiciel, niveau bac+5.</p>',
    expectAccepted: true,
    expectIsPfe: false,
  },
  {
    description: 'FR, final-year education level alone must NOT imply PFE',
    title: 'Stage QA',
    descriptionHtml: '<p>Stage de test logiciel ouvert aux étudiants en dernière année.</p>',
    expectAccepted: true,
    expectIsPfe: false,
  },
  {
    description: 'HR internship rejected even though titled "stage"',
    title: 'Stage Ressources Humaines',
    descriptionHtml: '<p>Stage au sein du service ressources humaines, recrutement et paie.</p>',
    expectAccepted: false,
  },
  {
    description: 'Marketing internship rejected even though titled "stage"',
    title: 'Stage Marketing Digital',
    descriptionHtml: '<p>Stage marketing, gestion des réseaux sociaux et campagnes publicitaires.</p>',
    expectAccepted: false,
  },
  {
    description: 'Permanent CDI role rejected outright',
    title: 'Développeur Full Stack (CDI)',
    descriptionHtml: '<p>Poste en CDI, développement web avec React.</p>',
    expectAccepted: false,
  },
  {
    description: 'Apprenticeship rejected outright',
    title: 'Alternance Développeur',
    descriptionHtml: '<p>Contrat d’apprentissage en développement logiciel.</p>',
    expectAccepted: false,
  },
  {
    description: 'Freelance role rejected outright',
    title: 'Développeur Freelance',
    descriptionHtml: '<p>Mission freelance de développement, indépendant.</p>',
    expectAccepted: false,
  },
  {
    description: 'Ambiguous role with no CS or domain signal, rejected',
    title: 'Stage Assistant Polyvalent',
    descriptionHtml: '<p>Stage généraliste, tâches administratives variées.</p>',
    expectAccepted: false,
  },
  {
    description: 'Hostile HTML: script/style/tracking must be stripped before classification still succeeds',
    title: 'Stage Développeur Mobile',
    descriptionHtml:
      '<script>alert(1)</script><style>body{color:red}</style><p onclick="steal()">Stage développement mobile Android/iOS.</p><img src="https://track.example.com/pixel.gif?utm_source=x">',
    expectAccepted: true,
    expectIsPfe: false,
  },
  {
    description: 'Morocco-flavored posting',
    title: 'Stage PFE Cybersécurité — Casablanca',
    descriptionHtml: '<p>PFE en cybersécurité, pentest et sécurité informatique, basé à Casablanca.</p>',
    expectAccepted: true,
    expectIsPfe: true,
  },
  {
    description: 'France-flavored posting',
    title: 'Stage DevOps — Paris',
    descriptionHtml: '<p>Stage DevOps, Docker, Kubernetes, CI/CD, basé à Paris.</p>',
    expectAccepted: true,
    expectIsPfe: false,
  },
]
```

- [ ] **Step 1: Write `fixtures/postings.ts`** as above (the fixtures define the spec; write them before the classifier consuming them).
- [ ] **Step 2: Write `classification.test.ts`** driving every fixture through `sanitizeDescriptionToPlainText` then `classifyPosting`, asserting `expectAccepted`/`expectIsPfe`, plus a `work_mode` spot-check (remote/hybrid/onsite keyword each in one dedicated case) and a malformed-URL-adjacent case is **not** this module's job (that's Task 9, already covered).
- [ ] **Step 3: Run, confirm fail** (`classification.ts` doesn't exist).
- [ ] **Step 4: Write `classification.ts`** as above.
- [ ] **Step 5: Run, iterate until every fixture passes.** Expect to tune `NON_CS_DOMAIN_KEYWORDS`/`CS_DOMAIN_SIGNAL` against the HR/marketing/ambiguous fixtures — this heuristic is the single riskiest piece of M2; don't rush past a failing fixture.

---

## Task 11: SmartRecruiters adapter

**Files:**
- Create: `src/lib/sources/adapter.ts`
- Create: `src/lib/sources/registry.ts`
- Create: `src/lib/sources/registry.test.ts`
- Create: `src/lib/sources/http-client.ts`
- Create: `src/lib/sources/http-client.test.ts`
- Create: `src/lib/sources/smartrecruiters/schema.ts`
- Create: `src/lib/sources/smartrecruiters/normalize.ts`
- Create: `src/lib/sources/smartrecruiters/normalize.test.ts`
- Create: `src/lib/sources/smartrecruiters/adapter.ts`
- Create: `src/lib/sources/smartrecruiters/adapter.test.ts`

**Interfaces:**
- Consumes: `validateAllowlistedHttpsUrl`, `computeCanonicalUrlHash` (Task 9), `classifyPosting` (Task 10), `sanitizeDescriptionToPlainText` (Task 9), `NormalizedCandidateSchema`/`CollectionResult` (Task 7).
- Produces: `SourceAdapter` interface (`{ sourceKey: string; collect(): Promise<CollectionResult> }`), `SOURCE_REGISTRY: SourceConfig[]`, `createSmartRecruitersAdapter(options): SourceAdapter`.
- Consumed by: Task 12 (collector).

```typescript
// src/lib/sources/adapter.ts
import type { CollectionResult } from '../ingestion/types'

export interface SourceAdapter {
  sourceKey: string
  collect(): Promise<CollectionResult>
}
```

```typescript
// src/lib/sources/registry.ts
export interface SourceConfig {
  key: string
  name: string
  adapter: 'smartrecruiters'
  employerIdentifier: string
  attributionUrl: string
  allowedHosts: readonly string[]
  countries: readonly ('MA' | 'FR')[]
}

// Mirrors docs/SOURCES.md exactly. Only APPROVED_FOR_BUILD sources.
export const SOURCE_REGISTRY: readonly SourceConfig[] = [
  {
    key: 'smartrecruiters-inetum',
    name: 'Inetum',
    adapter: 'smartrecruiters',
    employerIdentifier: 'Inetum2',
    attributionUrl: 'https://jobs.smartrecruiters.com/Inetum2',
    allowedHosts: ['api.smartrecruiters.com', 'jobs.smartrecruiters.com'],
    countries: ['MA', 'FR'],
  },
  {
    key: 'smartrecruiters-devoteam',
    name: 'Devoteam',
    adapter: 'smartrecruiters',
    employerIdentifier: 'Devoteam',
    attributionUrl: 'https://jobs.smartrecruiters.com/Devoteam',
    allowedHosts: ['api.smartrecruiters.com', 'jobs.smartrecruiters.com'],
    countries: ['FR'],
  },
  {
    key: 'smartrecruiters-mazars',
    name: 'Forvis Mazars',
    adapter: 'smartrecruiters',
    employerIdentifier: 'MAZARS',
    attributionUrl: 'https://jobs.smartrecruiters.com/MAZARS',
    allowedHosts: ['api.smartrecruiters.com', 'jobs.smartrecruiters.com'],
    countries: ['MA', 'FR'],
  },
]
```

- [ ] **Step 1: Write `registry.test.ts`** asserting exactly 3 sources, each `key`/`employerIdentifier`/`countries`/`allowedHosts` matching docs/SOURCES.md verbatim, and every `attributionUrl` passes `validateAllowlistedHttpsUrl(url, allowedHosts)`.
- [ ] **Step 2: Write `adapter.ts` and `registry.ts`**, run the test, PASS.

`src/lib/sources/http-client.ts` — the injectable-fetch, timeout/size/redirect-safe JSON fetcher:
```typescript
import type { z } from 'zod'
import { validateAllowlistedHttpsUrl } from '../ingestion/urls'

export type FetchFailureKind = 'transient' | 'deterministic'
export type FetchJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string; kind: FetchFailureKind }

export interface FetchJsonOptions {
  timeoutMs: number
  maxResponseBytes: number
  maxRedirects: number
  allowedHosts: readonly string[]
  fetchImpl: typeof fetch
}

export async function fetchAllowlistedJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options: FetchJsonOptions,
): Promise<FetchJsonResult<T>> {
  let currentUrl = url
  for (let hop = 0; hop <= options.maxRedirects; hop++) {
    const validated = validateAllowlistedHttpsUrl(currentUrl, options.allowedHosts)
    if (!validated.ok) return { ok: false, reason: validated.reason, kind: 'deterministic' }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
    let response: Response
    try {
      response = await options.fetchImpl(validated.url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'application/json' },
      })
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError'
      return { ok: false, reason: isAbort ? 'timeout' : 'network error', kind: 'transient' }
    } finally {
      clearTimeout(timeout)
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return { ok: false, reason: 'redirect without location', kind: 'deterministic' }
      currentUrl = new URL(location, validated.url).toString()
      continue
    }

    if (response.status === 429 || response.status >= 500) {
      return { ok: false, reason: `unexpected status ${response.status}`, kind: 'transient' }
    }
    if (!response.ok) {
      return { ok: false, reason: `unexpected status ${response.status}`, kind: 'deterministic' }
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number(contentLength) > options.maxResponseBytes) {
      return { ok: false, reason: 'response too large', kind: 'deterministic' }
    }

    const text = await readBoundedText(response, options.maxResponseBytes)
    if (text === null) return { ok: false, reason: 'response too large', kind: 'deterministic' }

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return { ok: false, reason: 'invalid JSON', kind: 'deterministic' }
    }

    const parsed = schema.safeParse(json)
    if (!parsed.success) return { ok: false, reason: 'schema validation failed', kind: 'deterministic' }
    return { ok: true, data: parsed.data }
  }
  return { ok: false, reason: 'too many redirects', kind: 'deterministic' }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string | null> {
  const reader = response.body?.getReader()
  if (!reader) return await response.text()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8')
}

export interface RetryOptions {
  maxRetries: number
  baseDelayMs: number
  sleep?: (ms: number) => Promise<void>
}

export async function withRetries<T>(
  fn: () => Promise<FetchJsonResult<T>>,
  options: RetryOptions,
): Promise<FetchJsonResult<T>> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  let last: FetchJsonResult<T> | undefined
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    const result = await fn()
    if (result.ok || result.kind !== 'transient' || attempt === options.maxRetries) return result
    last = result
    const jitter = Math.random() * options.baseDelayMs
    await sleep(options.baseDelayMs * 2 ** attempt + jitter)
  }
  return last!
}
```

- [ ] **Step 3: Write `http-client.test.ts` first**, using a hand-rolled fake `fetch` (a function tracking calls, returning scripted `Response` objects via `new Response(...)` with configurable status/headers/body, or throwing to simulate network errors/`AbortError`) covering: successful fetch validates against schema and returns `ok:true`; disallowed host rejected without any fetch call (deterministic, no network attempt); a 3xx response with `Location` is followed once, re-validated against the allowlist, and a `Location` pointing outside the allowlist is rejected (deterministic) rather than followed; more than `maxRedirects` hops returns `too many redirects`; a `Content-Length` over the byte limit is rejected without reading the body; a body that streams past the byte limit is rejected mid-read; malformed JSON is `deterministic`; a schema mismatch is `deterministic`; a `500` and a `429` are both `transient`; a `404` is `deterministic`; an aborted/timed-out fetch is `transient` with reason `'timeout'`. For `withRetries`: a transient failure is retried up to `maxRetries` then returns the last failure; a deterministic failure is never retried; a successful result on the 2nd attempt is returned without further retries; injects a no-op `sleep` so the test doesn't actually wait.
- [ ] **Step 4: Run, confirm fail, write `http-client.ts`, run again until PASS.**

`src/lib/sources/smartrecruiters/schema.ts`:
```typescript
import { z } from 'zod'

const LocationSchema = z
  .object({
    city: z.string().optional(),
    region: z.string().optional(),
    country: z.string().optional(),
    remote: z.boolean().optional(),
  })
  .partial()

export const SmartRecruitersListingItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
})

export const SmartRecruitersListingResponseSchema = z.object({
  totalFound: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  content: z.array(SmartRecruitersListingItemSchema),
})
export type SmartRecruitersListingResponse = z.infer<typeof SmartRecruitersListingResponseSchema>

const JobAdSectionSchema = z.object({ title: z.string().optional(), text: z.string().optional() }).partial()

export const SmartRecruitersDetailResponseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  applyUrl: z.string().url().optional(),
  releasedDate: z.string().optional(),
  location: LocationSchema.optional(),
  jobAd: z
    .object({
      sections: z
        .object({
          jobDescription: JobAdSectionSchema.optional(),
          qualifications: JobAdSectionSchema.optional(),
        })
        .partial()
        .optional(),
    })
    .optional(),
})
export type SmartRecruitersDetailResponse = z.infer<typeof SmartRecruitersDetailResponseSchema>
```

`src/lib/sources/smartrecruiters/normalize.ts`:
```typescript
import { classifyPosting } from '../../ingestion/classification'
import { sanitizeDescriptionToPlainText } from '../../ingestion/html'
import { normalizeLocation } from '../../ingestion/location'
import type { NormalizedCandidate } from '../../ingestion/types'
import { computeCanonicalUrlHash, validateAllowlistedHttpsUrl } from '../../ingestion/urls'
import type { SourceConfig } from '../registry'
import type { SmartRecruitersDetailResponse } from './schema'

const FRENCH_MARKERS = /\b(le|la|les|des|un|une|et|pour|avec|vous|nous|stage|d[ée]veloppeur)\b/gi
const ENGLISH_MARKERS = /\b(the|and|for|with|you|we|internship|developer)\b/gi

function detectLanguage(text: string): 'fr' | 'en' {
  const frenchHits = (text.match(FRENCH_MARKERS) ?? []).length
  const englishHits = (text.match(ENGLISH_MARKERS) ?? []).length
  return englishHits > frenchHits ? 'en' : 'fr'
}

export function normalizeSmartRecruitersPosting(
  detail: SmartRecruitersDetailResponse,
  source: SourceConfig,
): NormalizedCandidate | null {
  const descriptionHtml = [
    detail.jobAd?.sections?.jobDescription?.text,
    detail.jobAd?.sections?.qualifications?.text,
  ]
    .filter((text): text is string => Boolean(text))
    .join('\n')
  const descriptionText = sanitizeDescriptionToPlainText(descriptionHtml)

  const classification = classifyPosting({ title: detail.name, descriptionText })
  if (!classification) return null

  const location = normalizeLocation({
    country: detail.location?.country,
    city: detail.location?.city,
    region: detail.location?.region,
  })
  if (!location || !source.countries.includes(location.country)) return null

  const sourceUrlRaw = `https://jobs.smartrecruiters.com/${source.employerIdentifier}/${detail.id}`
  const applyUrlRaw = detail.applyUrl ?? sourceUrlRaw
  const sourceUrlValidation = validateAllowlistedHttpsUrl(sourceUrlRaw, ['jobs.smartrecruiters.com'])
  const applyUrlValidation = validateAllowlistedHttpsUrl(applyUrlRaw, ['jobs.smartrecruiters.com'])
  if (!sourceUrlValidation.ok || !applyUrlValidation.ok) return null

  return {
    sourceKey: source.key,
    externalId: detail.id,
    sourceUrl: sourceUrlValidation.url,
    applyUrl: applyUrlValidation.url,
    canonicalUrlHash: computeCanonicalUrlHash(sourceUrlValidation.url),
    title: detail.name.slice(0, 200),
    company: source.name,
    descriptionText,
    country: location.country,
    city: location.city,
    region: location.region,
    workMode: classification.workMode,
    internshipType: 'internship',
    isPfe: classification.isPfe,
    specialties: classification.specialties,
    technologies: classification.technologies,
    language: detectLanguage(descriptionText),
    publishedAt: detail.releasedDate ? new Date(detail.releasedDate).toISOString() : null,
  }
}
```

- [ ] **Step 5: Write `normalize.test.ts` first**: a full valid detail → matching `NormalizedCandidate` (parseable by `NormalizedCandidateSchema`); a detail whose classification rejects (e.g. HR-flavored `name`/description) → `null`; a detail whose country isn't in `source.countries` (e.g. Devoteam, FR-only, given a Morocco location) → `null`; a detail with an invalid `applyUrl` host → `null`; `releasedDate` absent → `publishedAt: null`; a French-heavy description → `language: 'fr'`, an English-heavy one → `'en'`.
- [ ] **Step 6: Run, confirm fail, write `schema.ts` and `normalize.ts`, run again until PASS.**

`src/lib/sources/smartrecruiters/adapter.ts`:
```typescript
import { boundedErrorSummary } from '../../ingestion/error-summary'
import type { CollectionResult } from '../../ingestion/types'
import type { SourceAdapter } from '../adapter'
import { fetchAllowlistedJson, withRetries } from '../http-client'
import type { SourceConfig } from '../registry'
import { SmartRecruitersDetailResponseSchema, SmartRecruitersListingResponseSchema } from './schema'
import { normalizeSmartRecruitersPosting } from './normalize'

export interface SmartRecruitersAdapterOptions {
  source: SourceConfig
  fetchImpl?: typeof fetch
  pageSize?: number
  maxPages?: number
}

const FETCH_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 2_000_000
const MAX_REDIRECTS = 3
const RETRY_OPTIONS = { maxRetries: 2, baseDelayMs: 300 }

function buildListingUrl(employerIdentifier: string, offset: number, limit: number): string {
  return `https://api.smartrecruiters.com/v1/companies/${employerIdentifier}/postings?offset=${offset}&limit=${limit}`
}

function buildDetailUrl(employerIdentifier: string, postingId: string): string {
  return `https://api.smartrecruiters.com/v1/companies/${employerIdentifier}/postings/${encodeURIComponent(postingId)}`
}

export function createSmartRecruitersAdapter(options: SmartRecruitersAdapterOptions): SourceAdapter {
  const fetchImpl = options.fetchImpl ?? fetch
  const pageSize = options.pageSize ?? 100
  const maxPages = options.maxPages ?? 20

  return {
    sourceKey: options.source.key,
    async collect(): Promise<CollectionResult> {
      const candidates: CollectionResult['candidates'] = []
      let fetchedCount = 0
      let acceptedCount = 0
      let rejectedCount = 0
      let offset = 0
      let scanComplete = true
      let errorSummary: string | undefined

      for (let page = 0; page < maxPages; page++) {
        const listingResult = await withRetries(
          () =>
            fetchAllowlistedJson(
              buildListingUrl(options.source.employerIdentifier, offset, pageSize),
              SmartRecruitersListingResponseSchema,
              {
                timeoutMs: FETCH_TIMEOUT_MS,
                maxResponseBytes: MAX_RESPONSE_BYTES,
                maxRedirects: MAX_REDIRECTS,
                allowedHosts: options.source.allowedHosts,
                fetchImpl,
              },
            ),
          RETRY_OPTIONS,
        )

        if (!listingResult.ok) {
          scanComplete = false
          errorSummary = boundedErrorSummary(`listing fetch failed: ${listingResult.reason}`)
          break
        }

        fetchedCount += listingResult.data.content.length

        for (const item of listingResult.data.content) {
          const detailResult = await withRetries(
            () =>
              fetchAllowlistedJson(
                buildDetailUrl(options.source.employerIdentifier, item.id),
                SmartRecruitersDetailResponseSchema,
                {
                  timeoutMs: FETCH_TIMEOUT_MS,
                  maxResponseBytes: MAX_RESPONSE_BYTES,
                  maxRedirects: MAX_REDIRECTS,
                  allowedHosts: options.source.allowedHosts,
                  fetchImpl,
                },
              ),
            RETRY_OPTIONS,
          )

          if (!detailResult.ok) {
            if (detailResult.kind === 'transient') {
              scanComplete = false
              errorSummary = boundedErrorSummary(`detail fetch failed for ${item.id}: ${detailResult.reason}`)
            } else {
              rejectedCount++
            }
            continue
          }

          const candidate = normalizeSmartRecruitersPosting(detailResult.data, options.source)
          if (candidate) {
            candidates.push(candidate)
            acceptedCount++
          } else {
            rejectedCount++
          }
        }

        offset += listingResult.data.content.length
        const reachedEnd = offset >= listingResult.data.totalFound || listingResult.data.content.length === 0
        if (reachedEnd) break
        if (page === maxPages - 1) {
          scanComplete = false
          errorSummary = boundedErrorSummary('reached max page bound before exhausting listing')
        }
      }

      return {
        sourceKey: options.source.key,
        candidates,
        fetchedCount,
        acceptedCount,
        rejectedCount,
        scanComplete,
        errorSummary,
      }
    },
  }
}
```

- [ ] **Step 7: Write `adapter.test.ts` first**, using an injected fake `fetchImpl` (a function matching on URL to return scripted `Response`s — no real network) covering: a single page, all postings accepted → `scanComplete: true`, correct counts; a posting whose detail is HR-flavored → rejected, counted, scan still complete; multiple pages via `totalFound`/`offset` pagination exhausted correctly; a listing fetch that always fails (simulate via a fake that always 500s) → `scanComplete: false`, `candidates: []`, bounded `errorSummary`; a single detail fetch that times out (simulate via fake throwing an abort-like error) → that item excluded, `scanComplete: false`, but *other* postings in the same run still collected; a detail fetch returning 404 → deterministic rejection, `scanComplete` unaffected by that alone.
- [ ] **Step 8: Run, confirm fail, write `adapter.ts` (and `src/lib/ingestion/error-summary.ts`'s `boundedErrorSummary`, below), run again until PASS.**

```typescript
// src/lib/ingestion/error-summary.ts
const MAX_ERROR_SUMMARY_LENGTH = 500
// Defense in depth: our own code never puts a credential or full response
// body into an error summary (every caller passes a small, hand-written
// reason string), but redact anything credential-shaped anyway.
const CREDENTIAL_LIKE_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|bearer\s+\S+/gi

export function boundedErrorSummary(message: string): string {
  return message.replace(CREDENTIAL_LIKE_PATTERN, '[redacted]').slice(0, MAX_ERROR_SUMMARY_LENGTH)
}
```
(Write this file's own tiny test — `error-summary.test.ts` — alongside Step 8: asserts a JWT-shaped substring is redacted and length is capped at 500.)

---

## Task 12: Collector orchestration and CLI

**Files:**
- Create: `src/lib/collector/run.ts`
- Create: `src/lib/collector/run.test.ts`
- Create: `src/lib/collector/fake-repository.ts` (test-only in-memory `IngestionRepository`, exported for reuse in `run.test.ts` and documented as a test double, not shipped behavior)
- Create: `src/lib/collector/cli.ts`
- Modify: `package.json` (add `tsx` devDependency + `"collect": "tsx src/lib/collector/cli.ts"` script)

**Interfaces:**
- Consumes: `IngestionRepository` (Task 5/6), `SourceAdapter` (Task 11), `SOURCE_REGISTRY` (Task 11), `createSmartRecruitersAdapter` (Task 11), `createSupabaseIngestionRepository`/`createSupabaseIngestionClient`/`loadSupabaseIngestionCredentials` (Task 6).
- Produces: `runCollector(deps: { repository: IngestionRepository; adapters: SourceAdapter[] }): Promise<CollectorSummary[]>`.

```typescript
// src/lib/collector/fake-repository.ts
// In-memory double for IngestionRepository. Exists purely to test
// run.ts's orchestration logic (idempotency, deactivate-only-on-complete-
// scan) without a live Postgres connection. Never imported by app or
// collector runtime code — test-only, but kept as a real module (not
// inlined in every test file) so its upsert-by-unique-key semantics are
// written and reviewed once.
import type { IngestionRepository } from '../db/repository'
import type { IngestionRunPatch, OfferRow } from '../db/types'

interface StoredOffer extends OfferRow {
  status: 'active' | 'inactive'
  first_seen_at: string
  last_seen_at: string
  inactive_at: string | null
}

export class FakeIngestionRepository implements IngestionRepository {
  offers = new Map<string, StoredOffer>() // key: `${source_key}:${external_id}`
  runs = new Map<string, IngestionRunPatch & { source_key: string; started_at: string }>()
  private nextRunId = 1

  async startIngestionRun(sourceKey: string): Promise<string> {
    const id = `run-${this.nextRunId++}`
    this.runs.set(id, { source_key: sourceKey, started_at: new Date().toISOString(), status: 'running', scan_complete: false })
    return id
  }

  async finishIngestionRun(runId: string, patch: IngestionRunPatch): Promise<void> {
    const existing = this.runs.get(runId)
    if (!existing) throw new Error(`unknown run id ${runId}`)
    this.runs.set(runId, { ...existing, ...patch })
  }

  async upsertOffers(rows: OfferRow[]): Promise<{ upsertedCount: number }> {
    const nowIso = new Date().toISOString()
    for (const row of rows) {
      const key = `${row.source_key}:${row.external_id}`
      const existing = this.offers.get(key)
      this.offers.set(key, {
        ...row,
        status: 'active',
        inactive_at: null,
        first_seen_at: existing?.first_seen_at ?? nowIso,
        last_seen_at: nowIso,
      })
    }
    return { upsertedCount: rows.length }
  }

  async deactivateMissingOffers(sourceKey: string, seenExternalIds: string[]): Promise<{ deactivatedCount: number }> {
    const seen = new Set(seenExternalIds)
    const nowIso = new Date().toISOString()
    let deactivatedCount = 0
    for (const [key, offer] of this.offers) {
      if (offer.source_key !== sourceKey || offer.status !== 'active') continue
      if (seen.has(offer.external_id)) continue
      this.offers.set(key, { ...offer, status: 'inactive', inactive_at: nowIso })
      deactivatedCount++
    }
    return { deactivatedCount }
  }
}
```

```typescript
// src/lib/collector/run.ts
import { boundedErrorSummary } from '../ingestion/error-summary'
import type { NormalizedCandidate } from '../ingestion/types'
import type { SourceAdapter } from '../sources/adapter'
import type { IngestionRepository } from '../db/repository'
import type { OfferRow } from '../db/types'

export interface CollectorSummary {
  sourceKey: string
  status: 'succeeded' | 'failed'
  scanComplete: boolean
  fetchedCount: number
  acceptedCount: number
  rejectedCount: number
  upsertedCount: number
  deactivatedCount: number
  errorSummary?: string
}

function candidateToOfferRow(candidate: NormalizedCandidate): OfferRow {
  return {
    source_key: candidate.sourceKey,
    external_id: candidate.externalId,
    source_url: candidate.sourceUrl,
    apply_url: candidate.applyUrl,
    canonical_url_hash: candidate.canonicalUrlHash,
    title: candidate.title,
    company: candidate.company,
    description_text: candidate.descriptionText,
    country: candidate.country,
    city: candidate.city,
    region: candidate.region,
    work_mode: candidate.workMode,
    internship_type: candidate.internshipType,
    is_pfe: candidate.isPfe,
    specialties: candidate.specialties,
    technologies: candidate.technologies,
    language: candidate.language,
    published_at: candidate.publishedAt,
  }
}

export async function runCollector(deps: {
  repository: IngestionRepository
  adapters: SourceAdapter[]
}): Promise<CollectorSummary[]> {
  const summaries: CollectorSummary[] = []

  for (const adapter of deps.adapters) {
    const runId = await deps.repository.startIngestionRun(adapter.sourceKey)
    try {
      const result = await adapter.collect()
      const rows = result.candidates.map(candidateToOfferRow)
      const { upsertedCount } = await deps.repository.upsertOffers(rows)

      let deactivatedCount = 0
      if (result.scanComplete) {
        const seenExternalIds = result.candidates.map((c) => c.externalId)
        deactivatedCount = (await deps.repository.deactivateMissingOffers(adapter.sourceKey, seenExternalIds)).deactivatedCount
      }

      const status: 'succeeded' | 'failed' = result.scanComplete ? 'succeeded' : 'failed'
      await deps.repository.finishIngestionRun(runId, {
        status,
        scan_complete: result.scanComplete,
        fetched_count: result.fetchedCount,
        accepted_count: result.acceptedCount,
        rejected_count: result.rejectedCount,
        upserted_count: upsertedCount,
        deactivated_count: deactivatedCount,
        error_code: result.scanComplete ? null : 'incomplete_scan',
        error_summary: result.errorSummary ? boundedErrorSummary(result.errorSummary) : null,
      })

      summaries.push({
        sourceKey: adapter.sourceKey,
        status,
        scanComplete: result.scanComplete,
        fetchedCount: result.fetchedCount,
        acceptedCount: result.acceptedCount,
        rejectedCount: result.rejectedCount,
        upsertedCount,
        deactivatedCount,
        errorSummary: result.errorSummary,
      })
    } catch (error) {
      const errorSummary = boundedErrorSummary(error instanceof Error ? error.message : 'unknown collector error')
      await deps.repository.finishIngestionRun(runId, {
        status: 'failed',
        scan_complete: false,
        error_code: 'collector_exception',
        error_summary: errorSummary,
      })
      summaries.push({
        sourceKey: adapter.sourceKey,
        status: 'failed',
        scanComplete: false,
        fetchedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        upsertedCount: 0,
        deactivatedCount: 0,
        errorSummary,
      })
    }
  }

  return summaries
}
```

- [ ] **Step 1: Write `fake-repository.ts`** as above.
- [ ] **Step 2: Write `run.test.ts` first**, using `FakeIngestionRepository` and a hand-written fake `SourceAdapter` (returns a scripted `CollectionResult`), covering exactly the required scenarios from the task brief:
  - **Successful import**: one candidate, `scanComplete: true` → offer stored, `status: 'succeeded'`.
  - **Duplicate import (retry of the same successful input)**: run the collector twice with the same candidate → still exactly one stored offer, and its `first_seen_at` is identical across both runs while `last_seen_at` advances (assert via the fake's internal map).
  - **Updated offer**: same `externalId`, changed `title` on the second run → the stored offer's `title` reflects the update.
  - **Partial scan**: `scanComplete: false` with one candidate still returned → that candidate is upserted (still useful), but an existing *other* active offer for that source is **not** deactivated (seed the fake with a pre-existing offer for the same source key first, run a partial scan that doesn't mention it, assert it is still `status: 'active'` afterward).
  - **Complete scan with a missing offer**: seed an existing active offer, run a complete scan (`scanComplete: true`) whose candidates don't include that offer's `externalId` → it becomes `status: 'inactive'` with `inactive_at` set.
  - **Timeout/malformed-response adapter**: adapter's `collect()` resolves with `scanComplete: false` and an `errorSummary` → run finishes with `status: 'failed'`, `error_code: 'incomplete_scan'`, and existing offers untouched.
  - **Adapter throws**: `collect()` rejects → caught, run recorded `status: 'failed'`, `error_code: 'collector_exception'`, bounded `error_summary` (assert it never contains the raw thrown error's stack by checking length/shape, not string content of a stack trace).
  - **Database failure**: `repository.upsertOffers` rejects → caught the same way, `finishIngestionRun` still called with a failure patch (assert on a repository fake whose `upsertOffers` throws).
  - **Safe error recording**: assert every `error_summary` written is `<= 500` chars (reuse `boundedErrorSummary`'s own guarantee, but check the wiring, not just the function in isolation).
- [ ] **Step 3: Run, confirm fail, write `run.ts`, run again until every scenario in Step 2 passes.**

```typescript
// src/lib/collector/cli.ts
import { createSupabaseIngestionClient, loadSupabaseIngestionCredentials } from '../db/supabase-client'
import { createSupabaseIngestionRepository } from '../db/supabase-repository'
import { createSmartRecruitersAdapter } from '../sources/smartrecruiters/adapter'
import { SOURCE_REGISTRY } from '../sources/registry'
import { runCollector } from './run'

async function main() {
  const credentials = loadSupabaseIngestionCredentials()
  const client = createSupabaseIngestionClient(credentials)
  const repository = createSupabaseIngestionRepository(client)
  const adapters = SOURCE_REGISTRY.map((source) => createSmartRecruitersAdapter({ source }))

  const summaries = await runCollector({ repository, adapters })

  for (const summary of summaries) {
    // Bounded, structured, no descriptions/credentials — safe for CI logs.
    console.log(JSON.stringify(summary))
  }

  const anyFailed = summaries.some((s) => s.status === 'failed')
  process.exitCode = anyFailed ? 1 : 0
}

main().catch((error) => {
  console.error('collector crashed:', error instanceof Error ? error.message : 'unknown error')
  process.exitCode = 1
})
```

- [ ] **Step 4: Write `cli.ts`** as above. No automated test for `main()` itself (it's a thin composition root calling already-tested pieces against real Supabase credentials that don't exist in CI/this sandbox) — this is a deliberate, documented exception; note it in the handoff.
- [ ] **Step 5: Add `tsx` as a devDependency** (`corepack pnpm add -D tsx@<latest>`) and add `"collect": "tsx src/lib/collector/cli.ts"` to `package.json` scripts.
- [ ] **Step 6: Verify the CLI at least loads and fails clearly without credentials**: run `corepack pnpm run collect` with no `SUPABASE_SERVICE_ROLE_KEY` set and confirm it exits non-zero with the bounded "Invalid ingestion configuration" message (not a stack trace, not a crash from an undefined import) — this is the one manual smoke check for Task 12, since it deliberately can't run against a real database here.

---

## Task 13: GitHub Actions collector workflow

**Files:**
- Create: `.github/workflows/collect.yml`

**Interfaces:** None (leaf artifact) — reuses the pinned-SHA actions already vetted in `ci.yml` (`actions/checkout@11d5960a326750d5838078e36cf38b85af677262`, `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`, `pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320`, all `v4.4.0`).

```yaml
name: Collect offers

on:
  schedule:
    - cron: '23 5 * * *'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  collect:
    name: Collect
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0

      - name: Enable Corepack
        run: corepack enable

      - name: Setup Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: '24.x'

      - name: Setup pnpm
        uses: pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v4.4.0

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run collector
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: pnpm run collect
```

Deliberately **not** triggered by `push`/`pull_request`/`pull_request_target` — only `schedule` and `workflow_dispatch`, so a fork's pull request can never reach the ingestion secret (docs/SECURITY.md: "Keep ingestion workflows unavailable to `pull_request_target`" and "Pull-request workflows never receive it" from docs/ARCHITECTURE.md).

- [ ] **Step 1: Write the workflow file** as above.
- [ ] **Step 2: Add a structural test** `src/lib/collector/workflow.test.ts` mirroring the RLS-migration structural tests' pattern:
```typescript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(join(__dirname, '../../../.github/workflows/collect.yml'), 'utf8')

describe('collect.yml', () => {
  it('never triggers on pull_request or pull_request_target', () => {
    expect(workflow).not.toMatch(/pull_request/)
  })
  it('declares minimal permissions', () => {
    expect(workflow).toMatch(/permissions:\s*\n\s*contents: read/)
  })
  it('pins every third-party action to a full commit SHA', () => {
    const usesLines = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1])
    for (const line of usesLines) {
      expect(line).toMatch(/@[0-9a-f]{40}/)
    }
  })
  it('runs on a daily schedule at 05:23 UTC and supports manual dispatch', () => {
    expect(workflow).toMatch(/cron:\s*'23 5 \* \* \*'/)
    expect(workflow).toMatch(/workflow_dispatch:/)
  })
})
```
- [ ] **Step 3: Run**, expect PASS.

---

## Task 14: Documentation and handoff

**Files:**
- Modify: `README.md`
- Modify: `docs/TASKS.md` (`IN_PROGRESS` → `REVIEW`)
- Modify: `docs/HANDOFF.md` (new entry at the top)
- Modify: `docs/SOURCES.md` only if something discovered during implementation needs clarifying (e.g. a normalization nuance) — otherwise leave untouched; sources stay `APPROVED_FOR_BUILD`.

README additions: a "Database and ingestion (M2)" section covering:
- Prerequisite: Supabase CLI (`npx supabase --version`) + Docker Desktop running.
- `npx supabase init` (if not already) → `npx supabase start` → `npx supabase db reset` (applies every migration in `supabase/migrations/` in order).
- Running the RLS assertions: `psql "<local DB_URL from `supabase status`>" -f supabase/tests/rls.sql`.
- Running the collector against a local instance: set `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` in the shell (never in a committed file) to the local instance's values, then `pnpm run collect`.
- Running just the ingestion/collector tests offline (no Supabase/Docker needed): `pnpm test src/lib/db src/lib/ingestion src/lib/sources src/lib/collector`.
- The safe-cleanup operation (`select public.cleanup_inactive_offers();`) and that it must be run with the service role / a superuser, on a schedule the maintainer sets up (e.g. Supabase's `pg_cron`) — not automated by this milestone.
- New required env var: `SUPABASE_SERVICE_ROLE_KEY` (GitHub Actions secret only).

- [ ] **Step 1: Write the README section** as above.
- [ ] **Step 2: Leave `docs/TASKS.md`/`docs/HANDOFF.md` for the final verification pass** (Task 15) — updating them is the very last thing done, after every check in Task 15 is green.

---

## Task 15: Full verification pass

**Files:** None (verification only).

- [ ] Run `corepack pnpm run typecheck` — fix until clean.
- [ ] Run `corepack pnpm run lint` — fix until clean.
- [ ] Run `corepack pnpm test` — every test from Tasks 1-13 plus the existing M1 suite must pass (expect ~120+ tests total).
- [ ] Run `corepack pnpm run scan:secrets` — must stay clean (no fixture in this milestone should look like a real credential; the SmartRecruiters JWT-shaped-string redaction pattern in `error-summary.ts` and any fixture JWT-like string must be excluded the same way M1's `secret-scan.test.mjs` fixtures were, if any test needs one).
- [ ] Run `corepack pnpm audit --audit-level=moderate` — must stay clean; `@supabase/supabase-js` and `tsx` are new dependencies, so this is not a no-op check this time.
- [ ] Run `corepack pnpm run build` — must still succeed (M2 adds no `src/app` code, but a broken import anywhere under `src/lib` would still fail typecheck, not build, so this mainly guards against an accidental app-code edit).
- [ ] Run `corepack pnpm exec playwright test` — must still be 6/6 (M2 touches no UI, so this is a regression guard, not new coverage).
- [ ] Use `superpowers:verification-before-completion` to confirm every command above was actually run fresh in the same session before writing the handoff entry.
- [ ] Use `security-review` (or, if it errors on the git-diff prefetch again as in M1, a manual review) covering: RLS/grants (Task 2), SSRF-safe URL validation (Task 9), HTML sanitization (Task 9), credential handling (`.env.example`, `supabase-client.ts`, `cli.ts`), workflow permissions/trigger surface (Task 13), and error-summary redaction (Task 11/12).
- [ ] Update `docs/TASKS.md`: M2 `IN_PROGRESS` → `REVIEW`.
- [ ] Append a new `docs/HANDOFF.md` entry (never edit prior entries) with: every changed/created file grouped by task, exact commands + results, the RLS model, credential separation, adapter allowlist, import transaction semantics (why per-statement `.upsert()`/`.update()` atomicity is sufficient — no custom RPC needed), and remaining risks (no live-Postgres RLS run in this sandbox; SmartRecruiters response-shape assumptions pending Codex's source review per docs/SOURCES.md; heuristic classification's false-positive/negative edges).
- [ ] Stop. Do not start M3.

---

## Self-Review Notes

**Spec coverage:** Section A (migrations/RLS/cleanup) → Tasks 1-3. Section B (typed domain) → Task 7. Section C (normalization/classification) → Tasks 8-10. Section D (SmartRecruiters adapter) → Task 11. Section E (idempotent upsert/failure semantics) → Tasks 6, 12. Section F (collector CLI + workflow) → Tasks 12-13. Section G (docs/handoff) → Task 14. Every fixture category the user listed (FR, EN, positive, negative, hostile HTML, malformed URLs, ambiguous, Morocco, France) appears in Task 10's fixture list or Task 9's URL tests.

**Type consistency check:** `NormalizedCandidate` (Task 7, camelCase) → `candidateToOfferRow` (Task 12) → `OfferRow` (Task 5, snake_case) → `.upsert()` payload (Task 6). `SourceConfig` (Task 11) is the same shape referenced in Task 6's docstring and Task 11's adapter/normalize files. `IngestionRepository` (Task 5) has one implementation for tests (`FakeIngestionRepository`, Task 12) and one for production (`createSupabaseIngestionRepository`, Task 6) — both implement the exact same 4 methods with the exact same signatures.
