# Source registry

Only sources marked `APPROVED` may be enabled. A source approval covers access method, allowed hosts, attribution, country scope, and collection constraints. Public availability does not by itself authorize unrestricted scraping.

| Key | Status | Adapter | Employer identifier | Countries | Allowed hosts | Attribution |
| --- | --- | --- | --- | --- | --- | --- |
| `smartrecruiters-inetum` | APPROVED_FOR_BUILD | SmartRecruiters | `Inetum2` | MA, FR | `api.smartrecruiters.com`, `jobs.smartrecruiters.com` | https://jobs.smartrecruiters.com/Inetum2 |
| `smartrecruiters-devoteam` | APPROVED_FOR_BUILD | SmartRecruiters | `Devoteam` | FR | `api.smartrecruiters.com`, `jobs.smartrecruiters.com` | https://jobs.smartrecruiters.com/Devoteam |
| `smartrecruiters-mazars` | APPROVED_FOR_BUILD | SmartRecruiters | `MAZARS` | MA, FR | `api.smartrecruiters.com`, `jobs.smartrecruiters.com` | https://jobs.smartrecruiters.com/MAZARS |

Before production activation, Codex must re-check endpoint behavior, current source terms/robots guidance where applicable, response fields, rate behavior, and working attribution links. Record the review date and change the status to `APPROVED`.

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
