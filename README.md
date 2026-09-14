# PFE Finder

Computer science internship search for Morocco and France. See `docs/` for
the product, architecture, source, and security specifications, and
`docs/TASKS.md` for delivery status.

This repository currently implements **M1 — project foundation and design
system** and **M2 — database and ingestion**: a Next.js App Router shell
(strict TypeScript, Tailwind CSS, environment validation, security headers,
a bilingual marketing homepage) plus a Supabase schema with row-level
security and a SmartRecruiters ingestion collector. There is still no
search API, results UI, filters, or favorites — that is M3.

## Requirements

- Node.js 24.x with [Corepack](https://nodejs.org/api/corepack.html) enabled
  (`corepack enable`). This project pins `pnpm@10.18.0` via `packageManager`
  in `package.json`; do not use the machine's global `npm`. Node 24.x is
  required because Vite 7 (a Vitest dependency) needs Node 20.19+ or
  22.12+ — Vercel also supports and defaults new projects to Node 24.x.

## Getting started

```bash
corepack pnpm install
corepack pnpm dev
```

Copy `.env.example` to `.env.local` and fill in real values before running
against a real Supabase project — see the comments in `.env.example` and
`docs/SECURITY.md`. Everything in this repository so far runs without any
environment variables set.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Start the development server |
| `pnpm build` | Production build |
| `pnpm start` | Serve a production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm test` / `pnpm test:watch` | Vitest unit/component tests |
| `pnpm test:e2e` | Playwright end-to-end tests (requires `pnpm exec playwright install`) |
| `pnpm scan:secrets` | Fail if tracked files contain secret-shaped content |
| `pnpm audit` | Dependency vulnerability audit |
| `pnpm collect` | Run the ingestion collector (needs Supabase credentials — see below) |
| `pnpm verify` | Runs all of the above (except `test:e2e` and `collect`) plus the build |

## Project structure

- `src/app` — App Router routes, layout, and Server Actions.
- `src/components` — presentational, server-rendered UI components.
- `src/lib/env.ts` — environment variable validation (see file header).
- `src/lib/i18n` — bilingual dictionaries and locale helpers.
- `src/lib/security-headers.ts`, `src/proxy.ts` — security headers and the
  per-request CSP nonce.
- `src/lib/db` — Supabase types, the `IngestionRepository` interface, and
  its real (`supabase-repository.ts`) implementation.
- `src/lib/ingestion` — source-agnostic domain: Zod schemas, HTML-to-text
  sanitization, SSRF-safe URL validation, location normalization, and
  versioned specialty/technology classification dictionaries.
- `src/lib/sources` — the `SourceAdapter` contract, the source registry
  (`docs/SOURCES.md` mirrored in code), an injectable-fetch HTTP client,
  and the SmartRecruiters adapter.
- `src/lib/collector` — orchestration (`run.ts`), an in-memory
  `IngestionRepository` fake used only by tests, and the CLI entry point
  (`cli.ts`, run via `pnpm collect`).
- `supabase/migrations` — schema, RLS policies, and the 30-day cleanup
  function, applied in filename order by the Supabase CLI.
- `supabase/tests/rls.sql` — documented, executable RLS assertions for a
  real Supabase/Postgres instance (see below — not run by `pnpm test`).
- `scripts/` — repository maintenance scripts (currently secret scanning).
- `e2e/` — Playwright end-to-end specs.

## Database and ingestion (M2)

### Local Supabase setup

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli) and
Docker Desktop running.

```bash
npx supabase start   # starts local Postgres + Studio (needs Docker)
npx supabase db reset  # applies every migration in supabase/migrations/, in order
npx supabase status   # prints the local DB URL and anon/service_role keys
```

### Verifying RLS, service_role privileges, and the finalize functions

`supabase/tests/rls.sql` asserts anonymous clients can read only active
offers and source-freshness fields and can never write anything, that
`service_role` (the collector's own credential) can perform exactly the
operations it needs — `BYPASSRLS` alone does **not** grant table access,
only the explicit `GRANT`s do — and that `finalize_completed_run`/
`finalize_failed_run` atomically deactivate offers, update source
freshness, and finish a run. Run it against the local instance:

```bash
psql "<DB URL from `supabase status`>" -f supabase/tests/rls.sql
```

See `supabase/tests/README.md` for the full explanation, a plain-Postgres
(no Supabase CLI) alternative using `bootstrap-roles.sql`, and using the
Supabase Studio SQL editor if `psql` isn't installed.

### Running the collector locally

The collector never reads `.env.local` (it's a separate process, run via
`tsx`, not the Next.js dev server). Export the two variables it needs in
your shell instead, pointing at the local instance from `supabase status`:

```bash
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=<local service_role key from `supabase status`>
pnpm run collect
```

### Running the ingestion/collector tests offline

Every test under `src/lib/db`, `src/lib/ingestion`, `src/lib/sources`, and
`src/lib/collector` runs without Docker, Supabase, or any network access —
they're included in the regular `pnpm test` run, or scope to just them:

```bash
pnpm exec vitest run src/lib/db src/lib/ingestion src/lib/sources src/lib/collector
```

### Cleaning up long-inactive offers

`select public.cleanup_inactive_offers();` deletes offers that have been
`inactive` for more than 30 days. It must be called with the service role
(or a superuser) — it's revoked from `anon`/`authenticated`. This isn't
automated by M2; run it manually or schedule it with Supabase's `pg_cron`
extension once the project is live.

### Required environment variables

See `.env.example` for the full list and rationale. New in M2:
`SUPABASE_SERVICE_ROLE_KEY` — server-only, GitHub Actions secret only,
never given a value in this file or in `.env.local`.
