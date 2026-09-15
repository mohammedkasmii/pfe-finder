# Delivery task board

Statuses: `BLOCKED`, `READY`, `IN_PROGRESS`, `REVIEW`, `CHANGES_REQUESTED`, `ACCEPTED`.

| ID | Milestone | Owner | Depends on | Status | Acceptance |
| --- | --- | --- | --- | --- | --- |
| M1 | Project foundation and design system | Claude | Documentation | ACCEPTED | Next.js/TypeScript/Tailwind scaffold, bilingual shell, responsive accessible visual system, environment validation, test/lint/typecheck/build scripts, `.env.example`, and CI workflow pass locally where supported. |
| M2 | Database and ingestion | Claude | M1 | ACCEPTED | Reproducible Supabase migrations/RLS, adapter contract, three configured sources, classification fixtures, safe URL/text normalization, idempotent upsert, complete-scan semantics, and collector tests pass. |
| M3 | Search and offer experience | Claude | M2 | REVIEW | Validated cursor API, filters in URL, offer list/detail pages, local favorites, bilingual states, freshness display, rate limiting, and component/API tests pass. |
| M4 | Security and resilience corrections | Claude | M3 | BLOCKED | All findings from Codex review resolved; malicious input, unauthorized writes, SSRF, source failure, headers, secret exposure, and dependency checks pass. |
| M5 | Production readiness | Claude | M4 | BLOCKED | Deployment documentation, operations runbook, initial-import instructions, production build, accessibility/browser smoke tests, and recovery procedure are complete. |
| R1 | Review M1 | Codex | M1 in REVIEW | ACCEPTED | Diff, architecture alignment, UX/accessibility baseline, and checks reviewed; result recorded here and in handoff. |
| R2 | Review M2 | Codex | M2 in REVIEW | ACCEPTED | Sources, schema, RLS, normalization, idempotency, and failure semantics reviewed. |
| R3 | Review M3 | Codex | M3 in REVIEW | CHANGES_REQUESTED | Product behavior, API validation, performance, accessibility, and browser flows reviewed. |
| R4 | Security review | Codex | M4 in REVIEW | BLOCKED | `docs/SECURITY.md` review tests executed with no unresolved high/medium findings. |
| R5 | Launch acceptance | Codex | M5 in REVIEW | BLOCKED | Complete acceptance suite passes and remaining free-tier limitations are documented. |

## Branch and review rules

- Use `codex/`-prefixed feature branches when branches are introduced. Until the initial commit exists, work sequentially in the shared checkout.
- A Claude task moves to `REVIEW` only with a handoff entry and its required checks.
- Codex records `ACCEPTED` or `CHANGES_REQUESTED` with concrete evidence. Acceptance unlocks the next milestone.
- Do not commit secrets, generated build output, dependency directories, or local environment files.
