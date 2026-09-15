# M3 — Search and Offer Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Adaptation note:** this milestone is executed inline, solo, by the same agent that wrote this plan (CLAUDE.md forbids parallel/subagent-driven skills in this shared checkout without explicit task-board authorization, and none was given). Task granularity is therefore per-file/per-feature rather than per 2-minute step — each task still ends with a run-and-verify checkpoint, but steps are not further subdivided.

**Goal:** Ship a validated, rate-limited `GET /api/offers` search API and a bilingual, accessible `/offers` search experience + `/offers/{uuid}` detail pages, backed by the M2 database, with local-only favorites — nothing else.

**Architecture:** A single Postgres function (`search_offers`, SQL, parameterized, RLS-respecting) does all filtering/sorting/keyset pagination server-side; a thin TypeScript domain layer (`src/lib/offers/`) maps rows to an explicit public field allowlist and wraps a signed, bounded opaque cursor; `GET /api/offers` (rate-limited via Upstash, fail-open when unconfigured or unreachable) and the `/offers` server page both call that same domain layer directly (no internal HTTP hop for SSR). A client component progressively enhances the SSR'd first page with in-place filter/pagination updates, URL sync, and an ARIA live region.

**Tech Stack:** Next.js 16 App Router Route Handlers + Server Components, Supabase Postgres (anon key only, RLS-enforced), Zod 4, `@upstash/ratelimit` + `@upstash/redis` (new deps), Vitest + Testing Library, Playwright.

**Spec:** `docs/ARCHITECTURE.md` (§ Application interfaces), `docs/PRODUCT.md` (§ V1 experience, § Classification, § Accessibility), `docs/SECURITY.md` (§ Mandatory controls, § Review tests), `docs/SOURCES.md` (§ Source health), and the user's M3 kickoff message (verbatim required-behavior and testing lists — treated as authoritative alongside the docs above).

## Global Constraints

- `GET /api/offers` param bounds: `q` ≤100 chars trimmed; `country` ∈ {MA,FR}; `city` ≤80 chars; `specialty` ∈ documented slugs; `technology` ≤40 chars; `workMode` ∈ {onsite,hybrid,remote,unknown}; `pfe` = `true` or omitted; `language` ∈ {fr,en}; `sort` ∈ {newest,recently-seen}; `cursor` opaque/signed/bounded; `limit` 1–24, default 12.
- Response shape: exactly `{ items, nextCursor, freshness }`; no internal ingestion fields, no raw errors.
- Never build `.or()` / `in` / SQL / filter grammar by string-interpolating user input — use a real parameterized SQL function or the supabase-js builder's own parameterized methods only.
- `SUPABASE_SERVICE_ROLE_KEY` must never be imported, read, or reachable from any file under `src/app/**` or any module `src/app/**` transitively imports. The web app reads only `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Rate limiter must be serverless/shared (no in-memory-only counter), must return 429 on limit, and must fail safe (allow the request through, never crash or leak an error) when unconfigured or unreachable.
- French is the default locale; every new user-facing string needs a complete English translation in the same `Dictionary` shape used by M1.
- Source titles/descriptions are never machine-translated — always rendered in their original stored language.
- No fake/fixture offers may reach production code paths; fixtures are test/dev-only.
- WCAG AA contrast, visible focus, full keyboard operability, no horizontal overflow at 320px — reuse the existing paper/ink/teal/terracotta design tokens in `src/app/globals.css`; do not introduce a new palette.
- Do not start M4/M5 work, provision real Upstash/Supabase production credentials, run a real ingestion, deploy, commit, or push.

---

## Task 1: Database — `search_offers` SQL function

**Files:**
- Create: `supabase/migrations/20260914020000_search_offers_function.sql`
- Modify: `supabase/tests/rls.sql` (append Part 6)
- Test: real-Postgres run of `supabase/tests/rls.sql` against the existing `pfe-pg-test` Docker container (no new Vitest file — this is SQL-only behavior)

**Interfaces:**
- Produces: `public.search_offers(p_query text, p_country text, p_city text, p_specialty text, p_technology text, p_work_mode text, p_pfe boolean, p_language text, p_sort text, p_cursor_value timestamptz, p_cursor_id uuid, p_limit integer) returns setof public.offers` — granted to `anon` only (revoked from `public`), `language sql stable`, default `security invoker` (so the existing `anon can read active offers` RLS policy still applies transparently; the function also hard-codes `status = 'active'` as defense in depth).
- Consumes: the `offers` table from `20260914010100_offers.sql` and the RLS policy from `20260914010300_rls.sql`.

**Design:**
- A small internal helper `public.escape_ilike_pattern(text) returns text` (immutable) escapes `\`, `%`, `_` so a user's literal `%`/`_` in `q`/`city` doesn't act as a wildcard.
- `q` matches `title`, `company`, or `city` via `ilike '%' || escape_ilike_pattern(p_query) || '%' escape '\'` — three ORs written as literal SQL inside the function body (not PostgREST `.or()`, not string-built at the TS layer).
- `specialty`/`technology` use `@> array[p_value]` (array containment, safe bound parameter).
- Sort key: `newest` orders by `coalesce(published_at, first_seen_at) desc, id desc`; `recently-seen` orders by `last_seen_at desc, id desc`. The `id desc` tiebreaker is what keeps pagination stable when many rows share the same timestamp.
- Keyset predicate (only applied when `p_cursor_id is not null`): for `newest`, `(coalesce(published_at, first_seen_at), id) < (p_cursor_value, p_cursor_id)`; for `recently-seen`, `(last_seen_at, id) < (p_cursor_value, p_cursor_id)`. Row-value comparison gives correct tuple ordering with no manual OR-chain.
- Caller always passes `p_limit = requested_limit + 1` (one extra row) so the TypeScript layer can detect "has next page" without a second COUNT query.

```sql
create or replace function public.escape_ilike_pattern(p_value text)
returns text
language sql
immutable
as $$
  select replace(replace(replace(p_value, '\', '\\'), '%', '\%'), '_', '\_');
$$;

create or replace function public.search_offers(
  p_query text,
  p_country text,
  p_city text,
  p_specialty text,
  p_technology text,
  p_work_mode text,
  p_pfe boolean,
  p_language text,
  p_sort text,
  p_cursor_value timestamptz,
  p_cursor_id uuid,
  p_limit integer
)
returns setof public.offers
language sql
stable
set search_path = public
as $$
  select o.*
  from public.offers o
  where o.status = 'active'
    and (p_country is null or o.country = p_country)
    and (p_city is null or o.city ilike '%' || public.escape_ilike_pattern(p_city) || '%' escape '\')
    and (p_specialty is null or o.specialties @> array[p_specialty])
    and (p_technology is null or o.technologies @> array[p_technology])
    and (p_work_mode is null or o.work_mode = p_work_mode)
    and (p_pfe is null or o.is_pfe = p_pfe)
    and (p_language is null or o.language = p_language)
    and (
      p_query is null
      or o.title ilike '%' || public.escape_ilike_pattern(p_query) || '%' escape '\'
      or o.company ilike '%' || public.escape_ilike_pattern(p_query) || '%' escape '\'
      or o.city ilike '%' || public.escape_ilike_pattern(p_query) || '%' escape '\'
    )
    and (
      p_cursor_id is null
      or (p_sort = 'recently-seen' and (o.last_seen_at, o.id) < (p_cursor_value, p_cursor_id))
      or (p_sort <> 'recently-seen' and (coalesce(o.published_at, o.first_seen_at), o.id) < (p_cursor_value, p_cursor_id))
    )
  order by
    (case when p_sort = 'recently-seen' then o.last_seen_at else coalesce(o.published_at, o.first_seen_at) end) desc,
    o.id desc
  limit p_limit;
$$;

revoke all on function public.search_offers(text,text,text,text,text,text,boolean,text,timestamptz,uuid,integer) from public;
grant execute on function public.search_offers(text,text,text,text,text,text,boolean,text,timestamptz,uuid,integer) to anon;
revoke all on function public.escape_ilike_pattern(text) from public;
grant execute on function public.escape_ilike_pattern(text) to anon;
```

**`rls.sql` Part 6 additions (as `anon`, matching Part 1's role):**
- Seed 3 active offers with distinct titles/companies/cities/specialties/technologies/timestamps (two sharing an identical `published_at` to prove tiebreak stability) plus 1 inactive offer.
- Assert: `search_offers` with no filters returns only active offers, newest-first.
- Assert: a `q` value equal to a literal SQL/script payload (e.g. `'; drop table offers; --`) returns zero rows (matched as inert text) and does not error.
- Assert: filtering by `specialty`/`technology`/`country`/`workMode`/`pfe` each narrows correctly.
- Assert: paging with `p_limit = 1` across the 2 equal-timestamp rows returns each exactly once across two calls (using the first call's last row's `(sort value, id)` as the second call's cursor) — proves no skipped/repeated rows.
- Assert: `escape_ilike_pattern('50%_off')` returns the doubled-escaped literal (`50\%\_off`), and a `q` of `50%` against a title that does NOT literally contain `50%` returns zero rows (proves `%` isn't treated as a wildcard).

- [ ] Write the `rls.sql` Part 6 assertions first (they will fail — function doesn't exist yet)
- [ ] Run `docker exec -i pfe-pg-test psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/rls.sql` against the current schema state and confirm Part 6 fails with "function does not exist"
- [ ] Add the migration file above
- [ ] Full fresh-schema reset + re-migrate + re-run `rls.sql`; confirm every assertion (old and new) prints `PASS` with exit 0
- [ ] Add a structural test in `src/lib/db/seed-and-grants.test.ts` (new `describe('search_offers migration (structural)')` block) asserting: no `.or(` and no raw `not.in` substring anywhere in the file, `revoke ... from public` appears before `grant ... to anon` for both functions, and the function body contains no string built from `||` outside the three documented `ilike` lines (regex-count check)

---

## Task 2: Env, public Supabase client, cursor signing secret

**Files:**
- Modify: `src/lib/env.ts` (add `cursorSecret: string` to `Env`; validate ≥32 chars and required in production, fixed dev fallback otherwise)
- Modify: `.env.example` (document `CURSOR_SECRET`)
- Create: `src/lib/db/public-client.ts`
- Test: `src/lib/env.test.ts` (extend), `src/lib/db/public-client.test.ts` (new)

**Interfaces:**
- Produces: `env.cursorSecret: string`; `getPublicSupabaseClient(): SupabaseClient` (singleton, anon key only).
- Consumes: nothing new besides existing `env.supabaseUrl` / `env.supabaseAnonKey`.

- [ ] Write failing tests: `loadEnv` throws in production when `CURSOR_SECRET` is missing or <32 chars; accepts and returns it when valid; defaults to a fixed non-empty dev string in development when absent.
- [ ] Implement the `env.ts` change (mirrors the existing `supabaseUrl`/`isProduction` pattern already in the file).
- [ ] Write a failing test: `getPublicSupabaseClient()` returns the same instance on repeated calls and never imports anything from `src/lib/db/supabase-client.ts` (grep-based test on the file's own source text asserting it does not import `SUPABASE_SERVICE_ROLE_KEY` or `supabase-client`).
- [ ] Implement `public-client.ts`.
- [ ] Run `pnpm exec vitest run src/lib/env.test.ts src/lib/db/public-client.test.ts` — confirm pass.

---

## Task 3: Offers query schema (strict + lenient)

**Files:**
- Create: `src/lib/offers/query-schema.ts`
- Test: `src/lib/offers/query-schema.test.ts`

**Interfaces:**
- Produces: `OFFERS_SORTS`, `OffersSort`, `DEFAULT_OFFERS_LIMIT = 12`, `MAX_OFFERS_LIMIT = 24`, `OffersQuerySchema` (strict Zod object schema for the API route), `type OffersQuery = z.infer<typeof OffersQuerySchema>`, `normalizeOffersSearchParams(params: URLSearchParams | Record<string, string | string[] | undefined>): { query: OffersQuery; ignoredKeys: string[] }` (lenient — used by the `/offers` page; never throws, drops one bad field at a time, always returns a fully-valid `OffersQuery` with defaults applied).
- Consumes: `SPECIALTY_SLUGS` from `src/lib/ingestion/dictionaries/specialties.ts`.

```ts
export const OFFERS_SORTS = ['newest', 'recently-seen'] as const
export type OffersSort = (typeof OFFERS_SORTS)[number]
export const DEFAULT_OFFERS_LIMIT = 12
export const MAX_OFFERS_LIMIT = 24
export const MAX_CURSOR_LENGTH = 512

export const OffersQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  country: z.enum(['MA', 'FR']).optional(),
  city: z.string().trim().min(1).max(80).optional(),
  specialty: z.enum(SPECIALTY_SLUGS).optional(),
  technology: z.string().trim().min(1).max(40).optional(),
  workMode: z.enum(['onsite', 'hybrid', 'remote', 'unknown']).optional(),
  pfe: z.literal('true').optional().transform((v) => (v === 'true' ? true : undefined)),
  language: z.enum(['fr', 'en']).optional(),
  sort: z.enum(OFFERS_SORTS).default('newest'),
  cursor: z.string().trim().min(1).max(MAX_CURSOR_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_OFFERS_LIMIT).default(DEFAULT_OFFERS_LIMIT),
})
export type OffersQuery = z.infer<typeof OffersQuerySchema>
```

`normalizeOffersSearchParams` validates each key against its OWN single-field schema (reuse the shapes above) and simply omits a key that fails, collecting omitted key names into `ignoredKeys`; `sort`/`limit` fall back to their defaults on failure rather than being omitted.

- [ ] Write failing tests: every field's boundary (100/101 chars for `q`, 80/81 for `city`, 40/41 for `technology`, non-enum `country`/`specialty`/`workMode`/`language`/`sort`, `limit` 0/1/24/25, `pfe` values other than `'true'` rejected/omitted, `cursor` >512 chars rejected). Injection-shaped strings (`<script>`, `'; drop table--`, `../../etc/passwd`) for `q`/`city`/`technology` must pass shape validation unchanged (they're just bounded strings at this layer — inertness is proven at the DB layer in Task 1, not here) but must still respect the length bound.
- [ ] Write failing tests for `normalizeOffersSearchParams`: a mix of one valid and one invalid param returns the valid one applied and the invalid one's key in `ignoredKeys`; an entirely empty input returns all defaults with `ignoredKeys: []`; a `limit` of `"999"` or `"abc"` normalizes to the default instead of being dropped-and-absent.
- [ ] Implement `query-schema.ts`.
- [ ] Run `pnpm exec vitest run src/lib/offers/query-schema.test.ts` — confirm pass.

---

## Task 4: Signed opaque cursor

**Files:**
- Create: `src/lib/offers/cursor.ts`
- Test: `src/lib/offers/cursor.test.ts`

**Interfaces:**
- Produces: `interface CursorPayload { sort: OffersSort; value: string; id: string }`, `signCursor(payload: CursorPayload, secret: string): string`, `verifyCursor(cursor: string, secret: string): CursorPayload | null` (returns `null` — never throws — on any tamper, bad signature, malformed base64/JSON, wrong shape, or over-length input).
- Consumes: `OffersSort` from Task 3, Node's `node:crypto` (`createHmac`, `timingSafeEqual`).

- [ ] Write failing tests: round-trip sign→verify returns the original payload; flipping one character in the signature half fails verification; flipping one character in the body half fails verification; a cursor with no `.` separator, more than one `.`, non-base64url characters, or length >512 all fail; a cursor signed with a DIFFERENT secret fails; the decoded JSON must match `CursorPayloadSchema` (`sort` ∈ `OFFERS_SORTS`, `value` a valid ISO datetime string, `id` a valid UUID) or verification fails even with a correct signature (defends against a payload shape drifting without a code change).
- [ ] Implement `cursor.ts` using base64url encode/decode helpers, HMAC-SHA256, `timingSafeEqual` (length-check first to avoid it throwing on mismatched lengths).
- [ ] Run `pnpm exec vitest run src/lib/offers/cursor.test.ts` — confirm pass, including a red/green check (temporarily break the signature comparison to confirm the flipped-character test actually fails without the fix, per systematic-debugging discipline for security-sensitive code).

---

## Task 5: Public offer mapping

**Files:**
- Create: `src/lib/offers/public-offer.ts`
- Test: `src/lib/offers/public-offer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PublicOfferSummary {
    id: string
    title: string
    company: string
    country: 'MA' | 'FR'
    city: string | null
    region: string | null
    workMode: 'onsite' | 'hybrid' | 'remote' | 'unknown'
    isPfe: boolean
    specialties: SpecialtySlug[]
    technologies: string[]
    language: 'fr' | 'en'
    publishedAt: string | null
    sourceName: string
    attributionUrl: string
  }
  export interface PublicOfferDetail extends PublicOfferSummary {
    descriptionText: string
    sourceUrl: string | null
    applyUrl: string | null
    lastSeenAt: string
  }
  export function toPublicOfferSummary(row: OfferDbRow): PublicOfferSummary
  export function toPublicOfferDetail(row: OfferDbRow): PublicOfferDetail
  ```
  where `OfferDbRow` is the raw shape returned by `search_offers`/a direct `offers` select (all table columns as snake_case).
- Consumes: `SOURCE_REGISTRY` from `src/lib/sources/registry.ts` (to resolve `source_key` → `{ name, attributionUrl, allowedHosts }`), `validateAllowlistedHttpsUrl` from `src/lib/ingestion/urls.ts`.

`toPublicOfferDetail` re-validates `source_url`/`apply_url` against the offer's own source's `allowedHosts` via `validateAllowlistedHttpsUrl`; on failure (or an unknown `source_key` not in the registry — e.g. a since-removed source) it sets that field to `null` rather than throwing, so the UI can hide an unsafe/stale link instead of rendering it. Both mapping functions explicitly enumerate every output field — no `...row` spreads — so a new internal DB column added later can never leak through by default.

- [ ] Write failing tests: a well-formed row maps to exactly the documented `PublicOfferSummary` fields (assert the result object's key set, not just a subset, to catch accidental over-exposure); `canonical_url_hash`/`external_id`/`source_key`/`status`/`created_at`/`updated_at`/`first_seen_at` never appear on the mapped object; a row whose `apply_url` host is NOT in its source's `allowedHosts` (simulating stale/tampered data) maps `applyUrl` to `null`; a row whose `source_key` isn't in `SOURCE_REGISTRY` maps both URLs to `null` and falls back to a generic `sourceName`/`attributionUrl` rather than throwing.
- [ ] Implement `public-offer.ts`.
- [ ] Run `pnpm exec vitest run src/lib/offers/public-offer.test.ts` — confirm pass.

---

## Task 6: `searchOffers` — the shared query function

**Files:**
- Create: `src/lib/offers/search-offers.ts`
- Create: `src/lib/offers/errors.ts` (`export class InvalidCursorError extends Error {}`)
- Test: `src/lib/offers/search-offers.test.ts` (fake Supabase client, same fake-builder pattern already proven in `src/lib/db/supabase-repository.test.ts`)

**Interfaces:**
- Produces:
  ```ts
  export interface SearchOffersParams {
    q?: string; country?: 'MA' | 'FR'; city?: string; specialty?: SpecialtySlug
    technology?: string; workMode?: WorkMode; pfe?: true; language?: 'fr' | 'en'
    sort: OffersSort; cursor?: string; limit: number
  }
  export interface Freshness { stale: boolean; mostRecentSuccessAt: string | null }
  export interface SearchOffersResult { items: PublicOfferSummary[]; nextCursor: string | null; freshness: Freshness }
  export async function searchOffers(client: SupabaseClient, params: SearchOffersParams, secrets: { cursorSecret: string }): Promise<SearchOffersResult>
  ```
- Consumes: Task 4's `verifyCursor`/`signCursor`, Task 5's `toPublicOfferSummary`, the `search_offers` RPC (Task 1), `.from('sources').select('last_success_at').eq('enabled', true)`.
- Throws: `InvalidCursorError` only when `params.cursor` is present and fails `verifyCursor` (bad signature/shape/tamper) — the caller (API route) maps this to a 400. A cursor that verifies but whose `sort` doesn't match `params.sort` is treated as absent (silently reset to page 1), not an error.

Freshness rule (per `docs/SOURCES.md`): `stale = true` when there are zero enabled sources, or the maximum `last_success_at` among enabled sources is `null`, or older than 48 hours.

- [ ] Write failing tests: no filters/no cursor calls the RPC with all `null` filter args and `p_limit = params.limit + 1`; when the RPC returns `limit + 1` rows, `items.length === limit` and `nextCursor` is a non-null string; when it returns ≤`limit` rows, `nextCursor` is `null`; a present, valid cursor is decoded and its `value`/`id` are passed as `p_cursor_value`/`p_cursor_id`; a cursor with the wrong `sort` is ignored (RPC called with `p_cursor_value: null`); a cursor that fails `verifyCursor` throws `InvalidCursorError` and never calls the RPC; `freshness.stale` is `true` when the sources query returns zero rows, `true` when the one row's `last_success_at` is >48h old, `false` when it's recent; every `PublicOfferSummary` field in `items` matches Task 5's mapping (spy/assert `toPublicOfferSummary` was applied, or assert the shape directly).
- [ ] Implement `search-offers.ts` + `errors.ts`.
- [ ] Run `pnpm exec vitest run src/lib/offers/search-offers.test.ts` — confirm pass.

---

## Task 7: Offer detail lookup

**Files:**
- Create: `src/lib/offers/get-offer.ts`
- Test: `src/lib/offers/get-offer.test.ts`

**Interfaces:**
- Produces: `export async function getOfferById(client: SupabaseClient, rawId: string): Promise<PublicOfferDetail | null>`.
- Consumes: Task 5's `toPublicOfferDetail`.

`rawId` is checked against `z.uuid()` BEFORE any DB call; a non-UUID string returns `null` immediately (no query issued — avoids leaking a Postgres cast-error path and avoids an unnecessary round trip). A UUID that doesn't match any row, or matches an `inactive` row, also returns `null` (the `.eq('status', 'active')` filter plus RLS both enforce this — defense in depth, testable independent of RLS via the fake client).

- [ ] Write failing tests: a malformed id (`'not-a-uuid'`, an empty string, a 300-char string) returns `null` without calling the client at all; a well-formed UUID with no matching row returns `null`; a well-formed UUID matching an `inactive`-status row returns `null` (assert the query included `.eq('status', 'active')`); a well-formed UUID matching an active row returns the `toPublicOfferDetail`-mapped object.
- [ ] Implement `get-offer.ts`.
- [ ] Run `pnpm exec vitest run src/lib/offers/get-offer.test.ts` — confirm pass.

---

## Task 8: Rate limiter (Upstash, fail-open)

**Files:**
- Create: `src/lib/rate-limit/config.ts` (`loadRateLimitConfig(source?): { url: string; token: string } | null`)
- Create: `src/lib/rate-limit/client-ip.ts` (`getClientIp(request: Request): string`)
- Create: `src/lib/rate-limit/limiter.ts` (`checkRateLimit(identifier: string): Promise<{ allowed: boolean }>`, `__resetRateLimiterForTests()`)
- Modify: `package.json` (add `@upstash/ratelimit`, `@upstash/redis`)
- Modify: `.env.example`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `README.md` (document `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, free-tier setup instructions, and the fail-open behavior — no real credentials anywhere)
- Test: `src/lib/rate-limit/config.test.ts`, `src/lib/rate-limit/client-ip.test.ts`, `src/lib/rate-limit/limiter.test.ts` (mock `@upstash/redis`'s `Redis` class and `@upstash/ratelimit`'s `Ratelimit.limit`)

**Interfaces:**
- Produces the three functions above. `checkRateLimit` returns `{ allowed: true }` (a) when `loadRateLimitConfig()` is `null` (not configured — documented, deliberate no-op so local dev/CI/this sandbox never depends on a real Redis), and (b) when the underlying `Ratelimit.limit()` call throws for any reason (network error, timeout) — caught, never rethrown, never logged with request/IP detail beyond a fixed bounded string.
- Consumes: nothing from earlier tasks.

```ts
// limiter.ts sketch
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { loadRateLimitConfig } from './config'

let limiter: Ratelimit | null | undefined

function getLimiter(): Ratelimit | null {
  if (limiter !== undefined) return limiter
  const config = loadRateLimitConfig()
  if (!config) { limiter = null; return null }
  limiter = new Ratelimit({
    redis: new Redis({ url: config.url, token: config.token }),
    limiter: Ratelimit.slidingWindow(30, '60 s'),
    timeout: 1000, // Upstash's own fail-open: a slow Redis call resolves as allowed
    analytics: false,
    prefix: 'pfe-offers',
  })
  return limiter
}

export async function checkRateLimit(identifier: string): Promise<{ allowed: boolean }> {
  const instance = getLimiter()
  if (!instance) return { allowed: true }
  try {
    const { success } = await instance.limit(identifier)
    return { allowed: success }
  } catch {
    return { allowed: true }
  }
}

export function __resetRateLimiterForTests(): void {
  limiter = undefined
}
```

`getClientIp` reads `x-forwarded-for` (first comma-separated value, trimmed) then `x-real-ip`, else the literal string `'unknown'` — Next.js 16 Route Handlers expose no `request.ip`/`request.geo` (confirmed against the Next.js source via Context7: the app-route request proxy explicitly returns `undefined` for both).

- [ ] Write failing tests for `loadRateLimitConfig`: returns `null` when either env var is missing; returns `null` when the URL isn't `https://`; returns the `{ url, token }` pair when both are valid.
- [ ] Write failing tests for `getClientIp`: single IP in `x-forwarded-for`; multiple comma-separated IPs (takes the first); falls back to `x-real-ip`; falls back to `'unknown'` with neither header.
- [ ] Write failing tests for `checkRateLimit`: not configured → `{ allowed: true }` and the mocked `Ratelimit` constructor is never called; configured + `limit()` resolves `{ success: true }` → `{ allowed: true }`; configured + `limit()` resolves `{ success: false }` → `{ allowed: false }`; configured + `limit()` rejects → `{ allowed: true }` (fail open) and nothing thrown.
- [ ] Implement all three modules.
- [ ] Run `corepack pnpm add @upstash/ratelimit @upstash/redis`.
- [ ] Run `pnpm exec vitest run src/lib/rate-limit` — confirm pass.
- [ ] Update `.env.example` with a new "Optional — shared rate limiting" section naming `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, both left blank, with a one-line comment: "Free tier at upstash.com; omit both to run with rate limiting disabled (fails open)." Update `docs/ARCHITECTURE.md`'s Application interfaces section and `docs/SECURITY.md`'s rate-limiting bullet to name the mechanism and the fail-open decision. Add a README subsection under the M3 features area.

---

## Task 9: `GET /api/offers` route handler

**Files:**
- Create: `src/app/api/offers/route.ts`
- Test: `src/app/api/offers/route.test.ts` (call the exported `GET` function directly with a constructed `Request`, per Next.js Route Handler testing convention — no server needed)

**Interfaces:**
- Produces: `export async function GET(request: Request): Promise<Response>`, `export const dynamic = 'force-dynamic'`.
- Consumes: Task 3 (`OffersQuerySchema`), Task 6 (`searchOffers`, `InvalidCursorError`), Task 8 (`checkRateLimit`, `getClientIp`), Task 2 (`getPublicSupabaseClient`, `env.cursorSecret`).

Response contract:
- 429 with `{ error: 'rate_limited' }` and a `Retry-After` header when `checkRateLimit` denies.
- 400 with `{ error: 'invalid_query' }` when `OffersQuerySchema.safeParse` fails (any oversized/malformed/wrong-type param).
- 400 with `{ error: 'invalid_cursor' }` when `searchOffers` throws `InvalidCursorError`.
- 503 with `{ error: 'service_unavailable' }` on any other thrown error (never the raw message/stack).
- 200 with `{ items, nextCursor, freshness }` and `Cache-Control: no-store` otherwise.

- [ ] Write failing tests: valid query → 200 with the exact three top-level keys and nothing else; each oversized/malformed param individually → 400 `invalid_query` (loop over a table of {param, badValue} pairs covering every field in the Global Constraints list); an unsigned/tampered/oversized cursor → 400 `invalid_cursor`; `checkRateLimit` mocked to deny → 429 with `Retry-After` present; `searchOffers` mocked to throw a generic `Error` → 503 with a body that does NOT contain the thrown message text; combined filters (e.g. `country=MA&specialty=data-ai&pfe=true`) all reach `searchOffers` in one call with all three params set.
- [ ] Implement `route.ts`.
- [ ] Run `pnpm exec vitest run src/app/api/offers/route.test.ts` — confirm pass.

---

## Task 10: i18n — offers/search/favorites/detail strings

**Files:**
- Modify: `src/lib/i18n/types.ts` (extend `Dictionary` with `nav.offers`, a new `offers` section: filters labels, sort labels, states (loading/empty/error/malformedQuery/stale), pagination, favorites copy, card labels, detail-page labels)
- Modify: `src/lib/i18n/dictionaries/fr.ts`, `src/lib/i18n/dictionaries/en.ts`
- Modify: `src/components/site-header.tsx` (add an "Offers"/"Rechercher" nav link to `/offers`)
- Test: `src/lib/i18n/config.test.ts` stays as-is; extend `src/components/site-sections.test.tsx` or add `src/lib/i18n/dictionaries.test.ts` asserting `en` and `fr` satisfy the same `Dictionary` shape (TypeScript's `satisfies Dictionary` already guarantees this at compile time — the test instead asserts no key holds an empty string, catching a copy-paste-and-forgot-to-translate mistake)

- [ ] Write the failing "no empty string values" structural test over both dictionaries (recursive walk).
- [ ] Extend `Dictionary` (types.ts) with the new sections needed by Tasks 11–13 (finalize the exact shape once those tasks' component props are drafted — see Task 11 for the concrete field list this task must satisfy).
- [ ] Write complete `fr`/`en` copy for every new key.
- [ ] Run `pnpm exec vitest run src/lib/i18n` — confirm pass.

---

## Task 11: Offers search page (SSR) + client search experience

**Files:**
- Create: `src/app/offers/page.tsx` (server component)
- Create: `src/app/offers/loading.tsx` (minimal skeleton, reuses design tokens)
- Create: `src/components/offers/offers-search-experience.tsx` (client component)
- Create: `src/components/offers/filters-panel.tsx`
- Create: `src/components/offers/offer-card.tsx`
- Create: `src/components/offers/offer-list.tsx`
- Create: `src/components/offers/freshness-banner.tsx`
- Create: `src/lib/favorites/use-favorites.ts` (client hook, `localStorage`, SSR-safe)
- Test: `src/lib/favorites/use-favorites.test.ts` (Testing Library, jsdom `localStorage`), `src/components/offers/offer-card.test.tsx`, `src/components/offers/offers-search-experience.test.tsx` (mock `fetch` to `/api/offers`, mock `next/navigation`'s `useRouter`/`usePathname`/`useSearchParams`)

**Interfaces:**
- `page.tsx` reads `searchParams` (Next 16: a `Promise<Record<string, string | string[] | undefined>>`), calls `normalizeOffersSearchParams` (Task 3), calls `searchOffers(getPublicSupabaseClient(), ..., { cursorSecret: env.cursorSecret })` (Tasks 2+6) directly for the first render, and passes `{ initialQuery, initialResult, ignoredKeys, locale, dictionary }` into `OffersSearchExperience`.
- `OffersSearchExperience` owns: filter form state; a debounced (300ms) re-fetch to `/api/offers` on any filter change (cursor reset to first page); "Load more" appending `nextCursor`-fetched items; URL sync via `useRouter().replace(...)` with `scroll: false`, reflecting every non-default filter value (omitting defaults keeps URLs minimal); a visually-hidden `aria-live="polite"` region announcing result-count changes, "Loading…", and error text; renders `FreshnessBanner` when `freshness.stale`; renders an empty-state message when `items.length === 0`; renders a fixed, translated notice when `ignoredKeys.length > 0` on first render only.
- `useFavorites()`: `{ isFavorite(id): boolean; toggleFavorite(id): void; favoriteIds: string[] }`, backed by `localStorage` key `pfe-finder:favorites` (JSON array of UUID strings, deduplicated, capped at a sane max e.g. 200 to bound storage); hydrates after mount (renders a neutral/unfavorited state during SSR to avoid a hydration mismatch, then syncs from `localStorage` in a `useEffect`).
- `OfferCard` renders: title (linked to `/offers/{id}`), company, `city`/`country` (or "—" when both null), work-mode badge, PFE badge (only when `isPfe`), specialty chips, technology chips, `publishedAt` formatted per-locale (or a translated "date unknown" string), `sourceName` attribution, and a favorite toggle button (`aria-pressed`, translated label).

- [ ] Write failing tests for `useFavorites`: starts empty; `toggleFavorite` adds then removes; persists across a hook re-mount (same `localStorage`); a second, independent hook instance in the same test sees the same persisted state after mount.
- [ ] Implement `use-favorites.ts`.
- [ ] Write failing tests for `OfferCard`: renders all documented fields; PFE badge only when `isPfe`; renders a translated fallback when `city`/`region`/`publishedAt` are `null`; favorite button toggles `aria-pressed` and calls the passed toggle callback; renders in both `fr` and `en` dictionaries.
- [ ] Implement `offer-card.tsx` (and `offer-list.tsx` as a thin list/grid wrapper).
- [ ] Write failing tests for `OffersSearchExperience`: initial render shows `initialResult.items` with no fetch; changing the country `<select>` triggers exactly one debounced fetch to `/api/offers?...&country=MA...` and replaces the URL; the live region's text changes to reflect a new result count after a fetch resolves; a fetch rejection renders the translated error state and an accessible-live-region error announcement, without crashing; `freshness.stale: true` renders `FreshnessBanner`; zero items renders the translated empty state; toggling a card's favorite button updates that button's `aria-pressed` without triggering a re-fetch.
- [ ] Implement `filters-panel.tsx`, `freshness-banner.tsx`, `offers-search-experience.tsx`.
- [ ] Implement `page.tsx` + `loading.tsx`; add the nav link in `site-header.tsx` (guarded behind the i18n key added in Task 10).
- [ ] Run `pnpm exec vitest run src/components/offers src/lib/favorites` — confirm pass.

---

## Task 12: Offer detail page

**Files:**
- Create: `src/app/offers/[id]/page.tsx`
- Create: `src/app/offers/[id]/not-found.tsx`
- Create: `src/components/offers/apply-link.tsx`
- Test: `src/components/offers/apply-link.test.tsx`

**Interfaces:**
- `page.tsx` (server component): `const { id } = await params`; calls `getOfferById(getPublicSupabaseClient(), id)` (Task 7); calls Next's `notFound()` when it returns `null`; otherwise renders title, company, location, badges, plain-text `descriptionText` (rendered as pre-wrapped text, never `dangerouslySetInnerHTML` — it is already-sanitized plain text per M2, and stays plain text here too), `lastSeenAt`/`publishedAt`, `ApplyLink`, a "Back to search" link, and a `<FavoriteButton>` (a thin client wrapper reusing `useFavorites`).
- `ApplyLink` is a small presentational component taking `{ href: string | null; label: string }`: renders nothing (or a translated "link unavailable" note) when `href` is `null` (Task 5 already re-validated it, but the component itself asserts `href.startsWith('https://')` as a last-line-of-defense before rendering, and always sets `target="_blank" rel="noopener noreferrer"`).

- [ ] Write failing tests for `ApplyLink`: null href renders no anchor; a non-`https://` href (should never happen given Task 5, but tested anyway as defense in depth) renders no anchor; a valid `https://` href renders an anchor with `target="_blank"` and `rel="noopener noreferrer"`.
- [ ] Implement `apply-link.tsx`.
- [ ] Implement `page.tsx` + `not-found.tsx` (bilingual, reusing `getDictionary`/`getLocale`).
- [ ] Run `pnpm exec vitest run src/components/offers/apply-link.test.tsx` — confirm pass.

---

## Task 13: Playwright e2e coverage

**Files:**
- Create: `e2e/offers-search.spec.ts`
- Create: `e2e/offers-detail.spec.ts`
- Modify: `e2e/homepage.spec.ts` only if the new nav link requires a locator update elsewhere (check, don't assume)

Given Playwright drives a real running app against the real (anon-key, RLS-enforced) Supabase config from `.env.local`/CI secrets — which are NOT available in this sandbox — these specs must not depend on real seeded data existing. Design them to assert structural/accessible behavior that holds even with zero offers:

- [ ] `offers-search.spec.ts`: `/offers` renders the filters form with labeled controls; typing in the search box and changing a filter updates the URL query string; the empty-state message (or item list) is present and keyboard-reachable; 320px viewport has no horizontal overflow; tabbing reaches every filter control and the language switch in a sensible order.
- [ ] `offers-detail.spec.ts`: `/offers/00000000-0000-0000-0000-000000000000` (a syntactically valid but certainly-nonexistent UUID) returns a 404-rendered page with a translated not-found message and a working link back to `/offers`; `/offers/not-a-uuid` also renders the not-found page (never a 500).
- [ ] Run `pnpm exec playwright test` (after starting the built app per the existing project convention — see `README.md`'s M2 section and prior HANDOFF entries for the exact `corepack pnpm start` + `pnpm exec playwright test` sequence) — confirm all new and existing specs pass.

---

## Task 14: Security review (inline) + full verification

- [ ] Re-read every file changed/created in Tasks 1–13 against `docs/SECURITY.md`'s Mandatory controls and Review tests, specifically: no `.or()`/raw filter-string building anywhere (`grep -rn "\.or(" src/`), `SUPABASE_SERVICE_ROLE_KEY` unreachable from `src/app/**` (`grep -rn "SUPABASE_SERVICE_ROLE_KEY\|supabase-client" src/app`), every external/user-facing link re-validated before rendering, cursor HMAC uses `timingSafeEqual`, rate limiter never throws past its own boundary, API route never echoes a raw error message or stack, no fixture/fake offer data reachable from `src/app/**` non-test code.
- [ ] Fix anything found; re-run the specific affected tests.
- [ ] Run the full fresh gate: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm scan:secrets`, `pnpm audit --audit-level=moderate`, `pnpm build`, `pnpm exec playwright test`, plus the real-Postgres `rls.sql` run from Task 1.
- [ ] Update `docs/TASKS.md` (M3 → `REVIEW`, M4/R3 stay `BLOCKED`) and append the Claude → Codex `docs/HANDOFF.md` entry (changed files, architecture choices, security findings + fixes, exact test results, remaining limitations — including the deliberate JS-required client-search scope choice and the fail-open rate-limiter tradeoff).

---

## Self-Review Notes

- **Spec coverage:** every bullet in the user's "Required application behavior", "Build the complete responsive experience", and "Testing must cover" lists maps to a task above (API param validation → Task 3/9; response shape → Task 6/9; parameterization → Task 1; rate limiting → Task 8/9; service-role exclusion → Task 2 test; filters/URL/pagination/sort → Tasks 3/4/11; cards/detail/plain-text/link re-validation → Tasks 5/11/12; favorites → Task 11; i18n → Task 10; a11y states/live region/keyboard/320px → Tasks 11/13; no fake production data → Task 14 grep check).
- **Type consistency check performed:** `OffersSort`, `SearchOffersParams`, `SearchOffersResult`, `PublicOfferSummary`/`PublicOfferDetail`, and `CursorPayload` are defined once (Tasks 3–5) and referenced by identical name/shape in every later task.
- **Known deliberate scope limits** (to state plainly in the HANDOFF, not hide): the search experience requires JavaScript (no no-JS `<form>` fallback path is built, unlike the existing language switch); a "favorites-only" cross-page view is out of scope for V1 — favorites are a per-card toggle only, exactly matching `docs/PRODUCT.md`'s literal description; Playwright specs avoid depending on real seeded offers since no Supabase project is provisioned in this sandbox.
