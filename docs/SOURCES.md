# Source registry

Only sources marked `APPROVED` may be enabled. A source approval covers access method, allowed hosts, attribution, country scope, and collection constraints. Public availability does not by itself authorize unrestricted scraping.

| Key | Status | Adapter | Employer identifier | Countries | Allowed hosts | Attribution |
| --- | --- | --- | --- | --- | --- | --- |
| `smartrecruiters-inetum` | APPROVED_FOR_BUILD | SmartRecruiters | `Inetum2` | MA, FR | `api.smartrecruiters.com`, `jobs.smartrecruiters.com` | https://jobs.smartrecruiters.com/Inetum2 |
| `smartrecruiters-devoteam` | APPROVED_FOR_BUILD | SmartRecruiters | `Devoteam` | FR | `api.smartrecruiters.com`, `jobs.smartrecruiters.com` | https://jobs.smartrecruiters.com/Devoteam |
| `smartrecruiters-mazars` | APPROVED_FOR_BUILD | SmartRecruiters | `MAZARS` | MA, FR | `api.smartrecruiters.com`, `jobs.smartrecruiters.com` | https://jobs.smartrecruiters.com/MAZARS |
| `smartrecruiters-wavestone` | APPROVED | SmartRecruiters | `Wavestone1` | MA (this milestone only) | `api.smartrecruiters.com`, `jobs.smartrecruiters.com` | https://jobs.smartrecruiters.com/Wavestone1 |
| `jooble-morocco` | APPROVED | Jooble | `ma.jooble.org` (fixed literal — no per-employer identifier for an aggregator API) | MA | `ma.jooble.org` | https://ma.jooble.org/ |

Before production activation, Codex must re-check endpoint behavior, current source terms/robots guidance where applicable, response fields, rate behavior, and working attribution links. Record the review date and change the status to `APPROVED`.

Both M6A additions were reviewed and approved by Codex on **2026-09-16** (the numeric-Jooble-job-ID correction verified, 95 focused M6A tests passed) and are now inserted **enabled** (`enabled = true`) by `supabase/migrations/20260916010000_m6a_jooble_and_wavestone_sources.sql` — approved for activation. That migration's `on conflict (key) do update set` still excludes `enabled` from the update list, so a maintainer's later manual disable survives re-running it.

### `smartrecruiters-wavestone` review evidence (2026-09-16)

- **Access method**: same public SmartRecruiters Posting API v1 the other three sources already use — no new endpoint shape, no new adapter code beyond the existing `createSmartRecruitersAdapter`.
- **Attribution**: https://jobs.smartrecruiters.com/Wavestone1 (working at review time).
- **Country scope**: `MA` only for this milestone — Wavestone's broader (non-Moroccan) postings are out of scope until a separate review adds `FR`.
- **Allowed hosts**: `api.smartrecruiters.com`, `jobs.smartrecruiters.com` (identical allowlist to every other SmartRecruiters source).
- **Query scope**: identical to the existing adapter's per-country listing traversal — no change to request shape or volume characteristics.
- **Current feed content**: the current public feed contains two Moroccan internship titles at review time.

### `jooble-morocco` review evidence and access method (2026-09-16)

- **Access method**: [Jooble REST API documentation](https://jooblehelpcenter.freshdesk.com/en/support/solutions/articles/60001448238-rest-api-documentation) — `POST https://ma.jooble.org/api/{JOOBLE_API_KEY}` with a JSON body. The key is a GitHub Actions secret (`JOOBLE_API_KEY`), read lazily inside `src/lib/sources/jooble/adapter.ts` only when the source actually collects — never part of this registry, `.env.example`, `src/lib/env.ts`, or any web application module. See docs/SECURITY.md for the full leakage-risk handling (the key lives in the URL *path*, not a header or query string).
- **Attribution**: https://ma.jooble.org/ (working at review time).
- **Country scope**: `MA` only.
- **Allowed hosts**: `ma.jooble.org` exactly — HTTPS required, redirects rejected outright (never followed), so the credential can never be forwarded to another host.
- **Query scope — exactly two fixed searches per collector run, never user-provided**:
  1. `keywords: "stage informatique"`, `location: "Maroc"`
  2. `keywords: "PFE informatique"`, `location: "Maroc"`

  Each request also fixes `page=1`, `ResultOnPage=50`, `companysearch=false`. No pagination beyond page 1 is implemented for any query.
- **Request budget**: 2 requests per successful daily collector run × 1 run/day = **2 requests/day**. The free API key has a 500-request lifetime quota, so at this fixed rate it lasts **approximately 250 collection days** (500 ÷ 2) before a new key is needed. If either fixed query's `totalCount` exceeds the 50 results returned, the scan is deliberately marked incomplete rather than paginating further to exhaust the quota faster.
- **Review evidence**: endpoint documented publicly by Jooble; response shape (`totalCount`, `jobs[]` with `id`/`title`/`location`/`snippet`/`type`/`link`/`company`/`updated`) validated against a strict, bounded Zod schema (`src/lib/sources/jooble/schema.ts`) before any field is trusted.

### Stage.ma — explicitly not approved

**Stage.ma is not approved for collection.** Its current terms grant personal/private viewing only, not automated collection or redistribution. It must not be added as a source, scraped, or referenced by any collector code, until a future terms change and a fresh Codex review explicitly approves it.

## Normalization rules

- Use the posting ID as `external_id` and the configured registry key as `source_key`.
- Fetch listing pages followed by official posting detail references only.
- Restrict locations to Morocco and France.
- Normalize HTML descriptions to bounded plain text; retain no tracking parameters.
- Prefer the source publication date; leave it null rather than inventing a date.
- Derive specialties and technologies from versioned, tested dictionaries.
- Compute PFE status using the explicit phrases in `docs/PRODUCT.md`.
- A scan is complete only after every advertised page/detail in its configured scope succeeds or is deterministically rejected as invalid.

## Source health

Record each run in `ingestion_runs`. Show a stale-data notice when no enabled source has succeeded within 48 hours. Disable a broken source only through a reviewed configuration change; transient failures must not delete or deactivate offers.
