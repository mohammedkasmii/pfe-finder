# Operations runbook

Day-to-day operational behavior and recovery procedures for a deployed
PFE Finder instance. For first-time setup and the launch checklist, see
`docs/DEPLOYMENT.md`.

## Daily collection behavior

- The "Collect offers" workflow (`.github/workflows/collect.yml`) runs
  on a schedule (`cron: '23 5 * * *'`, i.e. 05:23 UTC daily) and can also
  be triggered manually (`workflow_dispatch`, GitHub → **Actions** →
  **Collect offers** → **Run workflow**). A scheduled and a manual run
  share one `concurrency` group (`collect-offers`, `cancel-in-progress:
  false`) — a second run queues rather than overlapping or canceling the
  first.
- Each run calls `pnpm run collect`, which iterates every enabled source
  in `src/lib/sources/registry.ts` (mirrors `docs/SOURCES.md`), fetches
  and normalizes postings, and upserts them into `public.offers`.
- A **completed** scan (every configured page/detail succeeded or was
  deterministically rejected) deactivates any previously-seen offer no
  longer present, and updates that source's `sources.last_success_at`.
- A **failed or partial** scan (any transient network/timeout failure)
  never changes any offer's active status — it only records
  `sources.last_error_at` and an `ingestion_runs` row with
  `status = 'failed'`. Existing offers are always preserved on failure.
- The workflow's own job exits non-zero (visible as a failed GitHub
  Actions run) if any source's status is `failed`, even though offers
  were preserved — treat a failed run as "needs investigation," not
  "data was lost."

### Inspecting source freshness and failed runs

Run these in the Supabase Studio SQL editor (or `psql` against the
project's connection string):

```sql
-- Recent runs, newest first.
select source_key, status, scan_complete, fetched_count, accepted_count,
       rejected_count, upserted_count, deactivated_count, error_code,
       error_summary, started_at, finished_at
from public.ingestion_runs
order by started_at desc
limit 20;

-- Per-source freshness (what the public /offers page's stale-data
-- banner is computed from — see src/lib/offers/search-offers.ts).
select key, name, enabled, last_success_at, last_error_at
from public.sources
order by key;
```

The public `/offers` page shows a stale-data notice whenever **any**
enabled source has gone stale — `last_success_at` is null or older than
48 hours (`docs/SOURCES.md`) — even if other sources are healthy; a
single healthy source never masks a failing sibling
(`docs/HANDOFF.md` M3 review finding 6).

`error_summary` is bounded and redacted before it's written
(`src/lib/ingestion/error-summary.ts` strips credentials, connection
strings, and query strings, and truncates to 500 characters) — it is
safe to read directly in the Supabase dashboard. That redaction is
pattern-based defense in depth, not a guarantee that arbitrary upstream
text (a source's own error response, a network library's message) can
never contain something sensitive it doesn't recognize. Review it
yourself before pasting it into an issue, chat, or anywhere outside the
project, and redact further if anything in it looks unexpected.

## Recovery procedures

### Failed deployment (Vercel build fails)

1. Open the failed deployment in the Vercel dashboard and read the
   build log. A failure at the `next build` step almost always means
   `src/lib/env.ts` threw `EnvValidationError` — the log names exactly
   which environment variable is missing, empty, or malformed (see
   `docs/DEPLOYMENT.md` step 2 for the full list and where each belongs).
2. Fix the named variable in **Vercel → Settings → Environment
   Variables** and redeploy (Vercel dashboard → **Redeploy**, or push a
   new commit).
3. If the previous deployment was healthy, Vercel keeps serving it until
   the new one succeeds — a failed build does not take the site down.
   You can also explicitly **Promote to Production** an older, known-good
   deployment from the Vercel dashboard's deployment list while you fix
   the new one.

### Failed or partial collection

1. Check `ingestion_runs` (query above) for the failing `source_key` and
   read its `error_summary`.
2. Existing offers from that source (and every other source) are
   untouched — there is nothing to "roll back."
3. If the cause is transient (a timeout, a temporary 5xx from
   SmartRecruiters), simply re-run the workflow manually (GitHub →
   **Actions** → **Collect offers** → **Run workflow**); the next
   scheduled run will also retry automatically the next day.
4. If the cause looks persistent (the source's API shape changed, the
   employer identifier is wrong, credentials expired), treat it as a
   code/configuration issue, not an operational one — it needs a
   reviewed fix to the adapter or `docs/SOURCES.md`/
   `src/lib/sources/registry.ts`, not a re-run.

### Stale source

A source is stale when `sources.last_success_at` is null or more than
48 hours old for an `enabled` source.

1. Confirm via the freshness query above.
2. Check the most recent `ingestion_runs` row for that `source_key` — a
   run of `status = 'failed'` points at the underlying cause (see
   "Failed or partial collection" above).
3. If the source is broken for longer than a day or two and you want to
   stop the stale-data banner from showing while you investigate,
   disable it through a **reviewed configuration change**
   (`docs/SOURCES.md`: "Disable a broken source only through a reviewed
   configuration change; transient failures must not delete or
   deactivate offers.") — set `enabled = false` for that source in
   `public.sources` (directly in Supabase Studio, or via a new migration
   if the change should be tracked in version control) rather than
   editing data through the collector.
4. Re-enable it (`enabled = true`) once the underlying issue is fixed;
   the next scheduled or manual run picks it back up automatically.

### Compromised credentials and secret rotation

On Supabase's current key system (**Settings → API Keys** — publishable
and secret keys), the anon-equivalent and service-role-equivalent keys
can be individually revoked and replaced without touching each other. If
the project still uses the legacy JWT-based `anon`/`service_role` pair,
that independence does **not** hold: both are signed from the same
project JWT secret, so rotating that secret rotates both keys together —
plan for both env vars to change at once in that case. `CURSOR_SECRET`
and `UPSTASH_REDIS_REST_TOKEN` are unrelated to Supabase's keys and are
always independent of everything else in this table:

| Credential | Where it's used | Rotation steps |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions secret only (`collect.yml`) | In Supabase **Project Settings → API Keys**, revoke/replace the secret key (or roll the legacy `service_role` key's JWT secret if the project hasn't migrated). Update the GitHub Actions secret with the new value. No Vercel change needed — the web app never reads this key. On legacy keys, this also invalidates the current `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see note above) — rotate that row too in the same pass. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel (public) | In Supabase **Project Settings → API Keys**, revoke/replace the publishable key (or roll the legacy `anon` key's JWT secret). Update the Vercel environment variable and redeploy (it's inlined at build time). On legacy keys, this also invalidates the current `SUPABASE_SERVICE_ROLE_KEY` — rotate that row too in the same pass. |
| `CURSOR_SECRET` | Vercel (server-only) | Generate a new value (`openssl rand -base64 32`), update the Vercel environment variable, and redeploy. Rotating it invalidates every outstanding pagination cursor — a user mid-pagination simply gets `invalid_cursor` (HTTP 400) and needs to restart their search from page 1; no data is at risk. |
| `UPSTASH_REDIS_REST_TOKEN` | Vercel (server-only) | Roll the token in the Upstash console, update the Vercel environment variable, and redeploy. Rate limiting fails open during any gap (`src/lib/rate-limit/limiter.ts`), so a brief misconfiguration degrades to "unlimited" rather than "broken." |
| GitHub Actions secrets in general | Repository settings | If you suspect a secret leaked (e.g. accidentally logged or committed), rotate it at the source (Supabase/Upstash) first, then update the GitHub/Vercel copy — a leaked-but-since-rotated value is inert. |

After rotating anything, re-run the relevant production smoke check
from `docs/DEPLOYMENT.md` step 6 to confirm the app still works with the
new value.

### Database restoration or migration failure

- **A migration that has never successfully applied to this database
  fails** (`npx supabase db push`, a plain `psql -f <file>`, or a fresh
  Studio SQL editor run): check the actual database state before
  assuming anything about how much of the file took effect. A plain
  `psql -f <file>` is **not** automatically transactional — by default
  `psql` keeps executing later statements after an error and does not
  wrap the file in one transaction, so a partial failure can leave some
  of that file's own statements applied and others not. If you want
  atomic, all-or-nothing behavior, run it explicitly that way:
  ```bash
  psql "<connection string>" -v ON_ERROR_STOP=1 --single-transaction -f <file>
  ```
  (`-v ON_ERROR_STOP=1` stops on the first error instead of continuing;
  `--single-transaction`/`-1` wraps the whole file in one transaction
  that rolls back entirely on that error.) Pasting statements into the
  Studio SQL editor by hand carries the same non-atomicity risk. Either
  way, inspect the relevant table/policy/function directly (e.g. `\d
  public.<table>` in `psql`, or a `select` against it) to see what
  actually exists, fix the specific failing statement, and re-apply —
  do not assume "all of it applied" or "none of it did" without
  checking. Never skip ahead to a later migration first; every migration
  assumes every earlier one already succeeded exactly as recorded.
- **A migration that has already been applied to a shared/production
  database turns out to have a bug**: never edit, re-run, or delete an
  already-applied file. `supabase/migrations/` is an append-only,
  timestamp-ordered history that later migrations depend on matching
  reality; editing history after the fact breaks that guarantee for
  every future `db push`/`db reset`. Instead, write and apply a **new**
  forward migration (a new timestamp-prefixed file) that corrects the
  problem — e.g. an `ALTER` to fix a column, policy, or grant, or a
  `UPDATE` to backfill data — the same way you would fix any other
  shipped bug.
- **The deployed schema/data needs to be restored from a backup** — the
  available method depends on the Supabase plan:
  - **Paid plans (Pro and above)**: Supabase takes
    [automatic backups](https://supabase.com/docs/guides/platform/backups)
    (7/14/30 days of daily backups on Pro/Team/Enterprise respectively;
    Point-in-Time Recovery is available as a paid add-on for
    finer-grained restore points). Restore from **Project Settings →
    Database → Backups** in the dashboard. Note: daily backups do not
    store custom database role passwords, and Storage API objects are
    not covered — plan accordingly if either applies.
  - **Free plan — no automatic backups.** Two options, in increasing
    order of effort:
    - **Simpler, recommended for this project**: because every table
      `public.offers` writes to is fully re-derived from the live
      sources on the next collection run (ingestion is idempotent — see
      the bottom of this section) and favorites live only in each
      visitor's browser (never in the database), the practical recovery
      path for a lost/corrupted Free-plan project is: create a fresh
      Supabase project, apply all 10 migrations in order
      (`docs/DEPLOYMENT.md` step 1), point the app and the GitHub
      Actions secrets at the new project's URL/keys, and manually
      trigger "Collect offers" once (`docs/DEPLOYMENT.md` step 5). This
      restores current offers within one collection cycle. **What this
      does not restore**: the `ingestion_runs` history (past run logs
      and freshness timestamps) — that history is genuinely lost and
      starts over from zero on the new project.
    - **A real logical backup**, if you want one anyway (e.g. to
      preserve `ingestion_runs` history, or as a faster restore than
      re-collecting): `npx supabase db dump` backs up **schema only** by
      default — it does **not** include row data unless you also run
      the `--data-only` pass. Take both, explicitly targeting the
      linked project:
      ```bash
      npx supabase db dump --linked -f schema.sql
      npx supabase db dump --linked --data-only -f data.sql
      ```
      Restore both, in order, against a fresh/reset database, each as
      its own atomic transaction:
      ```bash
      psql "<connection string>" -v ON_ERROR_STOP=1 --single-transaction -f schema.sql
      psql "<connection string>" -v ON_ERROR_STOP=1 --single-transaction -f data.sql
      ```
      See the official
      [Supabase CLI `db dump` reference](https://supabase.com/docs/reference/cli/supabase-db-dump)
      for the full flag set (including `--role-only` for cluster-level
      roles) before relying on this for anything beyond a one-off dry
      run — restoring a schema+data pair correctly can also require
      adjusting default privileges on the target database first, which
      is out of scope for this project-specific runbook.
  - After any restore (any of the three paths above), re-check
    `select key, enabled from public.sources;` and re-apply, in order,
    any migration newer than the restore point.
- Regardless of cause, `public.offers` data loss is bounded: ingestion
  is idempotent (`(source_key, external_id)` and
  `(source_key, canonical_url_hash)` are both unique) and re-running the
  collector after a restore re-populates current data from the live
  sources within one collection cycle.

## Free-tier limitations and operational expectations

See `docs/DEPLOYMENT.md` step 7 for the full list and current provider
links (Supabase's inactivity-pause behavior, Vercel Hobby's limits,
Upstash's free-tier limits, GitHub Actions minutes). Operationally, this
means:

- There is no paging/alerting — a stale source or failed run is only
  visible by checking the GitHub Actions run history or the
  `ingestion_runs` table (this document's first section). Check
  periodically rather than expecting a notification.
- Roughly a week of low activity *may* pause the free Supabase project
  (Supabase's own wording: "may pause," not a fixed guaranteed
  countdown). The daily scheduled collection run contributes real
  activity but does not guarantee the project stays unpaused — if
  `/offers` ever fails to load entirely (not just a stale-data banner),
  check the Supabase dashboard for a paused-project notice and resume it
  from there; this is a manual action, not something the app or
  workflow detects on your behalf.
