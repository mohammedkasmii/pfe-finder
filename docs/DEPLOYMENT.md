# Deployment guide

Step-by-step setup for a real Supabase project, GitHub Actions secrets,
Vercel deployment, and Upstash rate limiting, plus the first collection run
and production smoke checks. For day-to-day operations and recovery
procedures once the app is live, see `docs/RUNBOOK.md`.

This document describes what a maintainer must do with their own accounts.
Nothing in this repository automates account creation, secret entry, or
deployment — every step below is a manual action outside this codebase.

## 0. Prerequisites

Accounts (all have a free tier sufficient for V1 — see "Free-tier
limitations" below):

- [GitHub](https://github.com) — already hosts this repository.
- [Supabase](https://supabase.com) — the Postgres database.
- [Vercel](https://vercel.com) — hosts the Next.js application.
- [Upstash](https://upstash.com) — Redis for mandatory production rate
  limiting.

Locally: Node.js 24.x with Corepack enabled (`corepack enable`), and the
[Supabase CLI](https://supabase.com/docs/guides/cli) (`npx supabase --version`
works without a separate install).

## 1. Supabase project setup

1. Create a new Supabase project in the [Supabase dashboard](https://supabase.com/dashboard).
   Note its project ref (in the project URL, e.g.
   `https://supabase.com/dashboard/project/<project-ref>`).
2. From the repository root, link the CLI to the new project:

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   ```

3. Apply every migration under `supabase/migrations/`, in filename order
   (the filenames are timestamp-prefixed, so plain lexical order is
   correct order — `npx supabase db push` applies exactly that order and
   is idempotent):

   ```bash
   npx supabase db push
   ```

   This applies, in order:

   1. `20260914010000_sources.sql`
   2. `20260914010100_offers.sql`
   3. `20260914010200_ingestion_runs.sql`
   4. `20260914010300_rls.sql`
   5. `20260914010400_cleanup_inactive_offers.sql`
   6. `20260914010500_seed_sources.sql` — seeds the three
      `docs/SOURCES.md` sources with `enabled = true`; no manual seeding
      step is needed.
   7. `20260914010600_offers_canonical_unique.sql`
   8. `20260914010700_service_role_grants.sql`
   9. `20260914010800_finalize_ingestion_run.sql`
   10. `20260914020000_search_offers_function.sql`

   If `db push` isn't available (e.g. no direct database connection),
   apply the same 10 files in the same order through the Supabase Studio
   SQL editor instead, one at a time, in the order listed above.

4. (Recommended, optional) Verify row-level security and the
   `service_role` grants against the real deployed database before going
   live — see `supabase/tests/README.md` for the exact `psql`/Studio
   procedure using `supabase/tests/rls.sql`. This was already verified
   against a local PostgreSQL 17 instance during development
   (`docs/HANDOFF.md`); re-running it against the actual production
   project is the launch-checklist item that confirms the *deployed*
   database matches.
5. From **Project Settings → API Keys**, note down:
   - **Project URL** → becomes `NEXT_PUBLIC_SUPABASE_URL`.
   - The **publishable key** (`sb_publishable_...`) → becomes
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`. This is Supabase's current
     browser-safe key type; it enforces row-level security the same way
     the older `anon` key does.
   - The **secret key** (`sb_secret_...`, click to reveal) → becomes
     `SUPABASE_SERVICE_ROLE_KEY`. This is Supabase's current
     backend-only key type; it bypasses row-level security — see
     "Ingestion-only secrets" below for exactly where it may and may not
     go.

   Supabase is deprecating the legacy JWT-based `anon`/`service_role`
   keys by the end of 2026, but they remain functional until then, and
   creating the new publishable/secret keys does not revoke them
   (both key systems work side by side). If your project still shows
   only the legacy keys, the older `anon public` and `service_role`
   values work identically for these two environment variables — the
   variable **names** in this repository (`NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`) stay the same either way, for code
   compatibility; only which key *type* you paste into them changes. See
   [Supabase API Keys](https://supabase.com/docs/guides/api/api-keys) for
   the current terminology and migration guidance.

   Unlike the legacy pair — which are both signed from the same
   project JWT secret, so rotating that secret rotates the `anon` and
   `service_role` keys **together** — the new publishable and secret
   keys are managed and can be individually revoked/replaced
   independently of each other (**Settings → API Keys**). Don't assume
   independent rotation if the project is still on legacy keys; see
   `docs/RUNBOOK.md` → "Compromised credentials and secret rotation" for
   the exact steps either way.

## 2. Environment variables

Every variable's purpose and validation rule is documented in
`.env.example` and enforced by `src/lib/env.ts` (the web app) or
`src/lib/db/supabase-client.ts` (the collector). Three separate places
hold configuration, and they must not mix:

### Vercel — public and server environment (Production environment)

Set these in the Vercel project's **Settings → Environment Variables**,
scoped to at least the **Production** environment (add to Preview too if
you want preview deployments to work against the same project):

| Variable | Purpose | Prefix |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project REST URL the browser and server both read from (RLS-bound, publishable/anon key only). | `NEXT_PUBLIC_` — reaches the browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase's current **publishable key** (or the legacy `anon` key on an older project) — see step 1.5. Row-level-security-bound, never bypasses RLS. | `NEXT_PUBLIC_` — reaches the browser |
| `NEXT_PUBLIC_SITE_URL` | Canonical public origin of the deployment (e.g. `https://pfe-finder.vercel.app`), used for metadata/absolute URLs. | `NEXT_PUBLIC_` — reaches the browser |
| `CURSOR_SECRET` | HMAC key that signs opaque pagination cursors (`src/lib/offers/cursor.ts`). Required in production, ≥32 characters. Generate with `openssl rand -base64 32`. | Server only |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint for `GET /api/offers` rate limiting. Required in production (see step 4). | Server only |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token, paired with the URL above. Required in production. | Server only |

Do **not** set `APP_ENV` on Vercel. `src/lib/env.ts` treats Vercel's own
`VERCEL_ENV` (which Vercel sets automatically to `production`, `preview`,
or `development` — no configuration needed) as authoritative for the
production environment and it can never be downgraded by `APP_ENV`; an
explicit `APP_ENV` is only useful for locally simulating `preview`/
`production` validation, which isn't needed on Vercel itself.

Do **not** set `SUPABASE_SERVICE_ROLE_KEY` here — see "Ingestion-only
secrets" below.

### GitHub Actions secrets

Set these in the repository's **Settings → Secrets and variables →
Actions → Repository secrets**. They are read only by the "Collect
offers" workflow (`.github/workflows/collect.yml`), which is never
triggered by `pull_request`/`pull_request_target`, so a fork's pull
request can never read them:

| Secret | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Same Supabase project URL as Vercel's. The collector reads it directly via `src/lib/db/supabase-client.ts`, independent of the Next.js app. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase's current **secret key** (or the legacy `service_role` key — see step 1.5). The ingestion credential; bypasses row-level security. Used only by `pnpm run collect` inside this workflow. |

The "CI" workflow (`.github/workflows/ci.yml`) needs no secrets at all —
typecheck, lint, unit tests, the production build, and the Playwright
suite all run without any real Supabase/Upstash credentials (the build
only *requires* them when `VERCEL_ENV`/`APP_ENV` resolve to
`production`, which is never the case in CI).

### Ingestion-only secrets that must never reach Vercel

`SUPABASE_SERVICE_ROLE_KEY` must exist **only** as the GitHub Actions
secret above. Per `.env.example` and `docs/SECURITY.md`:

- Never add it to Vercel's environment variables.
- Never put a real value in `.env.local` or any file in this repository.
- Never log it, screenshot it, or paste it into an issue/PR.
- The Next.js application never reads it — `src/lib/db/public-client.ts`
  only ever imports `@supabase/supabase-js` and the anon-key-based
  `env` module (enforced by that file's own test).

## 3. Vercel setup and deployment

1. In the [Vercel dashboard](https://vercel.com/new), import this
   GitHub repository as a new project. Vercel auto-detects the Next.js
   App Router framework preset — no build command override is needed
   (`pnpm build` / `next build` is the default).
2. Add all six Vercel environment variables from step 2 above under
   **Settings → Environment Variables**, scoped to Production (do this
   *before* the first deploy, or redeploy after adding them — Next.js
   inlines `NEXT_PUBLIC_` values at build time).
3. Deploy (Vercel deploys automatically on push to `main` once
   connected, or trigger a manual deploy from the dashboard).
4. Vercel assigns a free `*.vercel.app` production URL. Per
   `docs/PRODUCT.md`/`docs/ARCHITECTURE.md`, this free-tier URL is the
   V1 launch URL — no custom domain is required. Set
   `NEXT_PUBLIC_SITE_URL` to that exact URL and redeploy if it was set
   to a placeholder before the first deploy.
5. **Verify the deployment**:
   - The build succeeds in the Vercel dashboard's deployment log (a
     failed build here means a missing/invalid required production
     variable — `src/lib/env.ts` throws a specific, named
     `EnvValidationError` listing exactly which variable is missing or
     malformed; read the build log for that message).
   - Visit the production URL: the bilingual homepage renders.
   - Visit `<production-url>/offers`: the search page renders (it will
     show an empty/stale-data state until the first collection run —
     see section 5).
   - Confirm security headers are present:
     `curl -sI https://<production-url>/ | grep -i -E "content-security-policy|strict-transport-security|x-content-type-options|x-frame-options|referrer-policy|permissions-policy"`
     should print all six.

## 4. Upstash setup for mandatory production rate limiting

`docs/SECURITY.md` makes rate limiting on `GET /api/offers` (and the
`/offers` page's own initial request) mandatory in production —
`src/lib/env.ts` refuses to boot without it.

1. Create a free Redis database in the [Upstash console](https://console.upstash.com/).
2. From the database's **REST API** section, copy the **UPSTASH_REDIS_REST_URL**
   and **UPSTASH_REDIS_REST_TOKEN** values.
3. Add both as Vercel Production environment variables (step 2 above),
   then redeploy if the app was already deployed without them.

Once configured, a transient Upstash outage still fails open at runtime
(`src/lib/rate-limit/limiter.ts`) — this step is about deployment-time
configuration being present and valid, not about ongoing availability.

## 5. First collection/import procedure

The three sources in `docs/SOURCES.md` are seeded with `enabled = true`
by migration `20260914010500_seed_sources.sql` (step 1.3), so no manual
source-enabling step is required before the first run.

1. Confirm both GitHub Actions secrets from step 2 are set.
2. Open the repository's **Actions** tab → **Collect offers** workflow →
   **Run workflow** (the `workflow_dispatch` trigger) → run it on `main`.
   This is the same trigger the daily `23 5 * * *` UTC schedule uses, so
   a manual run is safe to trigger at any time — a scheduled run and a
   manual one share one `concurrency` group (`collect-offers`) and queue
   rather than overlap, so triggering it manually can never race a
   concurrent scheduled run.
3. Watch the run: the "Run collector" step prints one bounded JSON
   summary line per source (`sourceKey`, `status`, counts — never a
   description or credential; see `src/lib/collector/cli.ts`). The job
   exits non-zero if any source's status is `failed`, but a failed
   source never deactivates its previously-collected offers (see
   `docs/RUNBOOK.md` → "Failed or partial collection").
4. Verify in the Supabase Studio SQL editor:
   ```sql
   select source_key, status, scan_complete, fetched_count, accepted_count, upserted_count
   from public.ingestion_runs order by started_at desc limit 10;
   select count(*) from public.offers where status = 'active';
   ```
5. Reload `<production-url>/offers` — real offers now appear, and the
   stale-data banner (`docs/SOURCES.md`: shown when no enabled source
   has succeeded within 48 hours) should be absent.

## 6. Production smoke checks

Run these once after the first deploy and first successful collection
run. All are manual, exploratory checks against the real production URL
— they are not a substitute for `pnpm test`/`pnpm test:e2e`, which
already verify this behavior against deterministic fixtures.

- **Mobile**: open the production URL at a narrow viewport (browser
  DevTools device toolbar, ~320–390px). No horizontal overflow; the
  header navigation wraps cleanly; filters and cards remain usable.
- **Desktop**: open at a standard desktop width (~1280px+). Header,
  hero, how-it-works, specialties grid, coverage section, and footer all
  render as one row/grid layout, not stacked.
- **Bilingual**: toggle the language switch in the header. `<html
  lang>` changes, all visible French/English strings swap, and the
  toggle persists across a reload.
- **Accessibility**: tab through the homepage and `/offers` with the
  keyboard only — focus is always visible, the skip-to-content link
  works, every filter control has a reachable, labeled input.
- **Security headers**: the `curl -sI` check in step 3.5 above, run
  against the live production URL.
- **API**: `curl -s '<production-url>/api/offers?limit=1'` returns a
  JSON `{ items, nextCursor, freshness }` shape with HTTP 200; a
  malformed request (e.g. `?limit=abc`) returns HTTP 400; hitting the
  endpoint far more than 30 times within 60 seconds returns HTTP 429 if
  Upstash is configured (per `src/lib/rate-limit/limiter.ts`'s sliding
  window).
- **Filtering**: on `/offers`, apply a country and a specialty filter
  together; confirm the URL reflects both (`?country=...&specialty=...`)
  and results narrow; reload the page and confirm the filters survive.
- **Favorites**: mark an offer as a favorite, reload, confirm it's still
  marked; the device-only notice is visible.
- **Outbound links**: open an offer's detail page; confirm the "Postuler"
  (apply) link is `https://`, opens in a new tab
  (`target="_blank" rel="noopener noreferrer"`), and points at the
  correct source's real posting.

## 7. Free-tier limitations and operational expectations

- **Supabase free tier**: Supabase [may pause a Free-plan project after
  around 7 days of low activity](https://supabase.com/docs/guides/platform/going-into-prod)
  to save server resources. The daily scheduled collection run
  contributes real database activity, but this is **not a guarantee**
  that a quiet project stays unpaused — check it periodically (see
  `docs/RUNBOOK.md`), and manually resume it from the dashboard if it
  does pause (it isn't data loss — a paused project simply needs
  resuming). A fixed database size/bandwidth cap also applies — fine for
  V1's small, three-source scope.
- **Vercel free (Hobby) tier**: Hobby *does* support custom domains (up
  to 50 per project — see the [Hobby plan reference](https://vercel.com/docs/plans/hobby)
  and [working with domains](https://vercel.com/docs/domains/working-with-domains));
  V1 simply doesn't require one and uses the assigned `*.vercel.app` URL
  (see step 3.4). Hobby usage limits (bandwidth, function invocations,
  build minutes) are listed in full on that same reference page and
  change over time — check it directly rather than relying on a number
  frozen here; V1's traffic (a small friends-and-family audience) sits
  far under every Hobby threshold.
- **Upstash free tier**: current limits (data size, monthly command
  quota, bandwidth) are listed on [Upstash's pricing page](https://upstash.com/pricing)
  and change over time — check it directly rather than relying on a
  number frozen here. The app's own rate limit (30 requests/60s per
  client IP, `src/lib/rate-limit/limiter.ts`) is well within any current
  Upstash free-tier quota for a small friends-and-family audience.
- **GitHub Actions**: free minutes for a public repository are
  unlimited; a private repository has a monthly minutes cap shared
  across both workflows (`collect.yml` runs daily, bounded to 15 minutes
  by its own `timeout-minutes`; `ci.yml` runs per push/PR, bounded to 20).
- **No SLA**: this is a friends-and-family V1 (`docs/PRODUCT.md`), not a
  monitored production service — see `docs/RUNBOOK.md` for what to do
  when something breaks, and expect to check it manually rather than
  receive an alert.

## 8. Launch checklist

### Already done in this repository (verified by CI, no action needed)

- [x] Migrations are reproducible and applied in a fixed, documented
      order (`supabase/migrations/`, this document's step 1.3).
- [x] RLS policies and `service_role` grants pass their real-database
      test suite (`supabase/tests/rls.sql`, `docs/HANDOFF.md`).
- [x] Production headers (CSP, HSTS, frame denial, MIME sniffing,
      referrer policy, permissions policy) are implemented and unit
      tested (`src/proxy.ts`, `src/lib/security-headers.ts`).
- [x] Dependency audit and secret scan pass in CI
      (`pnpm audit`, `pnpm scan:secrets`).
- [x] Workflow permissions are minimal (`contents: read`), third-party
      actions are pinned to full commit SHAs, and both workflows have a
      `timeout-minutes` and a `concurrency` group.
- [x] Error pages and logs disclose no internals (`docs/HANDOFF.md` M4
      entry).
- [x] Source allowlists match `docs/SOURCES.md`.

### The user must perform, using their own accounts

- [ ] Create the Supabase project and apply all 10 migrations (step 1).
- [ ] Copy the Supabase URL, publishable key, and secret key (step 1.5).
- [ ] Set the six Vercel environment variables and deploy (steps 2–3).
- [ ] Set `NEXT_PUBLIC_SITE_URL` to the real assigned Vercel URL and
      redeploy if it changed (step 3.4).
- [ ] Create the Upstash Redis database and set its two variables in
      Vercel (step 4).
- [ ] Set the two GitHub Actions secrets (step 2 — GitHub Actions
      secrets table).
- [ ] Manually trigger the first "Collect offers" run and verify real
      offers appear (step 5).
- [ ] Run the production smoke checks (step 6).
- [ ] (Recommended) Run `supabase/tests/rls.sql` against the real
      deployed database once (step 1.4).
