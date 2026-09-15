# Architecture

## Components and data flow

1. A scheduled GitHub Actions workflow runs the TypeScript collector daily at 05:23 UTC; maintainers can also run it manually.
2. Source adapters fetch only configured allowlisted endpoints, normalize and classify postings, and upsert them into Supabase.
3. A completed full scan updates `last_seen_at` and marks previously seen missing offers inactive. A failed or partial scan never changes active state.
4. The Next.js application reads active offers through a server-side repository and exposes a validated read-only search endpoint.
5. Vercel serves bilingual pages. Browser state contains only locale, filters, and favorite offer IDs.

## Stack

- Next.js App Router and strict TypeScript
- Tailwind CSS with project-owned design tokens
- Supabase PostgreSQL with migrations and row-level security
- Zod at network and environment boundaries
- Vitest and Testing Library for unit/component tests; Playwright for critical browser flows
- GitHub Actions for CI and daily ingestion

## Data model

### `sources`

`key` text primary key, `name`, `adapter`, `employer_identifier`, `attribution_url`, `allowed_hosts` text array, `countries` text array, `enabled`, `last_success_at`, `last_error_at`, `created_at`, `updated_at`.

### `offers`

`id` UUID primary key, `source_key` foreign key, `external_id`, `source_url`, `apply_url`, `canonical_url_hash`, `title`, `company`, `description_text`, `country`, `city`, `region`, `work_mode`, `internship_type`, `is_pfe`, `specialties` text array, `technologies` text array, `language`, `published_at`, `first_seen_at`, `last_seen_at`, `inactive_at`, `status`, `created_at`, `updated_at`.

Constraints: unique `(source_key, external_id)`; country limited to `MA`/`FR`; status limited to `active`/`inactive`; URLs must be HTTPS before persistence. Index active status with publication date, country, city, PFE flag, specialties, and technologies. Inactive offers are retained for 30 days before cleanup.

### `ingestion_runs`

`id` UUID primary key, `source_key` foreign key, `started_at`, `finished_at`, `status`, `scan_complete`, `fetched_count`, `accepted_count`, `rejected_count`, `upserted_count`, `deactivated_count`, and `error_code`/`error_summary`. Summaries must contain no credentials or full descriptions.

## Application interfaces

`GET /api/offers` accepts:

- `q`: trimmed text, maximum 100 characters.
- `country`: `MA` or `FR`.
- `city`: maximum 80 characters.
- `specialty`: one documented specialty slug.
- `technology`: maximum 40 characters.
- `workMode`: `onsite`, `hybrid`, `remote`, or `unknown`.
- `pfe`: `true` or omitted.
- `language`: `fr` or `en`.
- `sort`: `newest` or `recently-seen`.
- `cursor`: opaque signed/validated pagination value.
- `limit`: integer from 1 to 24, default 12.

Return `{ items, nextCursor, freshness }`. Each public item excludes internal errors and ingestion metadata. Stable detail pages use `/offers/{uuid}` and return 404 for inactive or missing offers.

All filtering, sorting, and keyset pagination happen inside one parameterized Postgres function (`search_offers`, `security invoker`, RLS-respecting) so the TypeScript layer never builds a PostgREST `.or()`/`in`/filter-grammar string from user input. The cursor is an HMAC-SHA256-signed, length-bounded opaque token (`src/lib/offers/cursor.ts`) encoding the last row's sort key and id — never trusted without verifying its signature first.

`GET /api/offers` and the `/offers` server page's own initial request are both rate-limited per client IP via Upstash Redis (`@upstash/ratelimit` + `@upstash/redis`, serverless/shared across function instances — unlike an in-process counter, which resets per Vercel invocation and provides no real protection). Rate limiting is **mandatory in production** — environment validation refuses to boot without a complete, valid `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` pair — and stays optional only in development/CI, where both may be left unset. Once configured, a runtime Redis error/timeout still fails open (the request proceeds normally rather than the API breaking or exposing the underlying error) — a rate limiter is an abuse/cost control, not the app's security boundary (RLS, parameterized queries, and bounded parameters are).

## Source adapter contract

Each adapter exposes a configured source key and `collect(): Promise<CollectionResult>`. A result includes normalized candidates, completeness, and bounded metrics. Fetching accepts no browser/user URL. Network requests have timeouts, response-size limits, retry only transient errors with jitter, and reject redirects outside the allowlist.

Initial source configuration uses SmartRecruiters public company feeds for Inetum, Devoteam, and Forvis Mazars, filtered to Morocco and France. New employers or platforms require a source review in `docs/SOURCES.md` before activation.

## Deployment configuration

- Vercel holds public Supabase URL/key and server read configuration. Only variables explicitly prefixed `NEXT_PUBLIC_` may enter browser bundles.
- GitHub Actions holds the dedicated ingestion credential. Pull-request workflows never receive it.
- Database schema changes are committed migrations. Production migrations run as an explicit maintainer action before deploying dependent code.
- The free-tier Vercel URL is the launch URL; no custom domain or authentication is required for V1.
