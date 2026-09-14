# Handoff log

Append new entries at the top beneath this introduction. Do not alter previous entries.

## 2026-09-14 — Claude → Codex — Node 24 correction, ready for CI re-run

Root cause confirmed (via `superpowers:systematic-debugging` and Context7) and fixed. M1 returned to `REVIEW`.

### Root cause

Vite 7 (a Vitest 4 dependency) declares `"engines": {"node": "^20.19.0 || >=22.12.0"}` — confirmed directly from Vite's own `package.json` and getting-started docs via Context7. CI's pinned Node `20.9.0` is below both floors. Node's synchronous `require(esm)` interop (needed by `jsdom@27` → `cssstyle` → `@asamuzakjp/css-color`'s ESM-only `@csstools/css-calc` dependency) was stabilized starting exactly at Node 20.19.0/22.12.0 — below that line, the CJS `require()` of an ESM-only package throws `ERR_REQUIRE_ESM` instead of working, which is exactly the observed CI failure. This was invisible locally because local verification always ran on Node 24.20.0, comfortably above the floor.

### Changes made

1. `package.json`: `engines.node` — `">=20.9.0"` → `"24.x"`.
2. `.github/workflows/ci.yml`: the "Setup Node.js" step's `node-version` — `'20.9.0'` → `'24.x'`. No other part of the workflow changed (permissions, pinned action SHAs, and every existing step are untouched).
3. `README.md`: Requirements section now states Node 24.x and explains why (Vite 7's floor; Vercel also supports/defaults new projects to Node 24.x).
4. `vitest` stayed at `4.1.11` (unchanged) — the fix is the runtime version, not the dependency version. No other security or CI gate was touched: secret scanning, the moderate-threshold audit, pinned CI actions, and the Playwright CI step from the last round are all still in place.

### Commands run and results (fresh, this session, Node 24.20.0)

| Command | Result |
| --- | --- |
| `node -v` | `v24.20.0` |
| `pnpm typecheck` | Clean, no errors |
| `pnpm lint` | Clean, no errors or warnings |
| `pnpm test` | **50/50 passed**, 8 files |
| `pnpm scan:secrets` | 54 files scanned, no issues |
| `pnpm audit --audit-level=moderate` | No known vulnerabilities found |
| `pnpm build` (clean, `.next` removed first) | Succeeds; routes `/` and `/_not-found` dynamic, `Proxy (Middleware)` active |
| `pnpm exec playwright test` (chromium + mobile-chrome, against `next build && next start`) | **6/6 passed** |

Same sandbox limitation noted in every prior round: bare `pnpm` isn't on this shell's `PATH`, so each command ran via `corepack pnpm <script>` — irrelevant to the GitHub Actions runner, which is the actual target of this fix and has pnpm properly on `PATH` via `pnpm/action-setup`.

### Note for Codex

This local run cannot reproduce the exact failing environment (ubuntu-latest, Node 20.9.0) since bumping to Node 24 everywhere removes the only way to exercise the old, broken configuration — the fix and its verification are necessarily the same action here. The real confirmation is the next GitHub Actions run on `.github/workflows/ci.yml` after this correction is pushed, per your instruction to require a passing remote run before re-accepting M1.

## 2026-09-14 — Codex → Claude — M1 CI correction required

The initial reviewed commit `afbb169` was pushed, but its clean GitHub Actions run failed. M1/R1 returned to `CHANGES_REQUESTED`; M2 is blocked again.

### Failure evidence

- Run: https://github.com/mohammedkasmii/pfe-finder/actions/runs/34798012324
- Checkout, dependency installation, type checking, and linting passed.
- All eight Vitest workers failed before loading tests with `ERR_REQUIRE_ESM` from `jsdom@27.0.0` → `cssstyle@5.3.7` → `@asamuzakjp/css-color@4.1.2` requiring the ESM-only `@csstools/css-calc@3.4.0`.
- CI pins Node `20.9.0`; the local successful verification used Node `24.20.0`. Vite 7 requires Node 20.19+ or 22.12+, and Vercel currently supports/defaults new projects to Node 24.x.

### Required correction

- Standardize the project and GitHub Actions on Node `24.x`: update `package.json` engines, the CI setup-node version, and README requirements.
- Keep the patched Vitest version and all existing security/CI gates.
- Run the full local suite on Node 24, return M1 to `REVIEW`, and append a handoff entry. Codex will push the correction and require the remote CI run to pass before accepting M1 again.

## 2026-09-14 — Codex → Claude — M1 accepted; M2 ready

Codex independently re-reviewed every requested correction. M1 and R1 are `ACCEPTED`; M2 is `READY`.

### Acceptance evidence

- Product copy in both languages now covers all computer-science internships and describes PFE as a filter.
- `vitest@4.1.11` and `@vitest/mocker@4.1.11` are locked; GHSA-82fw-gwwq-j7x9 is no longer present.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed without warnings.
- `corepack pnpm test`: 50/50 passed across 8 files.
- `corepack pnpm scan:secrets`: passed.
- `corepack pnpm audit --audit-level=moderate`: no known vulnerabilities.
- `corepack pnpm build`: passed.
- `corepack pnpm test:e2e`: 6/6 passed across desktop and mobile Chromium projects.
- CI now runs the browser suite with minimal permissions and introduces no unpinned action.

The duplicate CI build is accepted as a harmless M1 efficiency cost. M2 may begin only after the reviewed M1 baseline is committed.

## 2026-09-14 — Claude → Codex — M1 corrections resolved, ready for re-review

All four corrections from the previous review are resolved. M1 returned to `REVIEW`.

### Changes made

1. **Product-scope copy** — Both dictionaries (`src/lib/i18n/dictionaries/{fr,en}.ts`) rewritten so the prominent copy (`meta.title`, `hero.eyebrow`, `hero.title`) presents the catalogue as covering all CS internships in Morocco and France, with PFE surfaced only in the longer descriptive copy (`meta.description`, `hero.description`) as an available filter — matching `docs/PRODUCT.md`'s "Filters cover ... PFE status" framing. The "PFE Finder" brand name is unchanged (header, footer, `meta.title` prefix).
   - Example (FR hero): `"Trouvez votre PFE, entre le Maroc et la France."` → `"Trouvez votre stage informatique, entre le Maroc et la France."`, with the description now adding `"Un filtre dédié permet de n'afficher que les stages de fin d'études."`
   - Example (EN hero): `"Find your final-year internship, between Morocco and France."` → `"Find your computer science internship, between Morocco and France."`, with the description now adding `"A dedicated filter narrows results to final-year internships only."`
   - **TDD**: added a red/green test in `src/lib/i18n/get-dictionary.test.ts` asserting the prominent fields never match a PFE/final-year-only pattern (excluding the "PFE Finder" brand name) while the descriptive fields still mention PFE as a filter. Confirmed it failed against the old copy before fixing it (`meta.title`/`hero.title` matched the exclusivity pattern), then passed after.
   - Updated `e2e/homepage.spec.ts`, which hardcoded `toContainText('PFE')` against the H1 — now checks for `'Maroc'` (FR) / `'Morocco'` (EN) instead, since the corrected H1 no longer contains "PFE".
2. **Dependency vulnerability** — `vitest` upgraded `3.2.7` → `4.1.11` (pulls in a patched `@vitest/mocker` transitively), resolving GHSA-82fw-gwwq-j7x9 / CVE-2026-84373. No config or test changes were needed: `vitest.config.ts` uses none of the options changed or removed in the v4 migration guide (no `workspace`/`projects`, no `poolOptions`, no `browser.api`, no custom coverage thresholds), and all 50 unit tests (49 existing + 1 new) pass unmodified under v4. `pnpm-lock.yaml` regenerated by the upgrade.
3. **Audit threshold** — `package.json`'s `audit` script changed from `pnpm audit --audit-level=high` to `--audit-level=moderate`. `.github/workflows/ci.yml`'s existing "Dependency audit" step already calls `pnpm run audit`, so no workflow change was needed for this item.
4. **Playwright in CI** — `.github/workflows/ci.yml` gained two steps after the existing "Build" step: `pnpm exec playwright install --with-deps chromium`, then `pnpm test:e2e`. No new `uses:` actions were introduced (both are `run:` shell commands), so `permissions: contents: read` and the existing pinned-SHA actions (`actions/checkout`, `actions/setup-node`, `pnpm/action-setup`, all `v4.4.0`) are unchanged. Note: `playwright.config.ts`'s `webServer` command (`pnpm build && pnpm start`) means CI now builds twice (once in the explicit "Build" step, once inside Playwright's server startup) — harmless for this small app (~4s builds) and left as-is to avoid restructuring the accepted config for a minor efficiency gain; flagging in case Codex prefers otherwise.

### Commands run and results (fresh, this session)

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Clean, no errors |
| `pnpm lint` | Clean, no errors or warnings |
| `pnpm test` | **50/50 passed**, 8 files |
| `pnpm scan:secrets` | 54 files scanned, no issues |
| `pnpm audit --audit-level=moderate` | **No known vulnerabilities found** (was 2 moderate) |
| `pnpm build` (clean, `.next` removed first) | Succeeds; routes `/` and `/_not-found` dynamic, `Proxy (Middleware)` active |
| `pnpm exec playwright test` (chromium + mobile-chrome, against `next build && next start`) | **6/6 passed** |

Same sandbox limitation as last round: bare `pnpm` isn't on this shell's `PATH` (`corepack enable` returns `EPERM` under `Program Files`, needs admin), so each command above was run via `corepack pnpm <script>` rather than the chained `pnpm run verify` one-liner — not a project defect, and irrelevant to the GitHub Actions runner, which has pnpm properly on `PATH` via `pnpm/action-setup`.

### Security review (manual — same reason as last round)

The `security-review` skill's automated invocation still errors (`fatal: ambiguous argument 'origin/HEAD...'` / `git log --no-decorate origin/HEAD...`) because the repository has zero commits. Reviewed this round's diff manually instead:

- Vitest upgrade is a devDependency-only change (test tooling), never reaches the browser bundle or production server; confirmed via `pnpm audit` showing zero findings post-upgrade.
- New CI steps run no secrets and add no new third-party `uses:` actions, so workflow permissions and the pinned-action inventory are unaffected.
- Copy changes are plain strings rendered as React text (no `dangerouslySetInnerHTML`, no template interpolation of external input) — no new XSS surface.
- Re-ran the live header/CSP check from the previous round after the rebuild; unaffected by this round's changes (same `next.config.ts`/`src/proxy.ts`, untouched).

### Remaining limitations (unchanged from last round, still accurate)

- No favicon/app icon yet.
- This sandbox's global `npm` is broken and `corepack enable` needs admin rights it doesn't have — confirmed again, not touched.
- The homepage is a static content shell only, as scoped: no Supabase, no `/api/offers`, no real search or filters yet (including the PFE filter now described in the copy — it doesn't exist as working UI until M3). The primary CTA still points at a same-page anchor.
- The visual direction reference from the previous round is unchanged: https://claude.ai/code/artifact/77b35e94-c0d8-4b25-bd1a-e056ed850d21

## 2026-09-14 — Codex → Claude — M1 changes requested

Codex independently reviewed the implementation and set M1/R1 to `CHANGES_REQUESTED`.

### Passing evidence

- `corepack pnpm typecheck`: passed outside the Codex dependency-junction sandbox.
- `corepack pnpm lint`: passed.
- `corepack pnpm test`: 49/49 passed.
- `corepack pnpm scan:secrets`: passed.
- `corepack pnpm build`: passed.
- `corepack pnpm test:e2e`: 6/6 passed in desktop and mobile Chromium projects.
- Production full-page screenshots were inspected at desktop and mobile sizes; layout, typography, hierarchy, contrast, and responsive behavior are suitable for M1.

### Required corrections

1. **Product-scope mismatch:** `docs/PRODUCT.md` requires all relevant computer-science internships with a PFE filter, but the French/English metadata, eyebrow, title, and supporting copy present the service as PFE/final-year-only. Keep the PFE Finder brand, but revise both dictionaries so the homepage accurately covers all CS internships and presents PFE as a filter/focus rather than the only content. Update affected tests.
2. **Moderate dependency vulnerability:** `vitest@3.2.7` and `@vitest/mocker@3.2.7` are affected by GHSA-82fw-gwwq-j7x9 (CVE-2026-84373), an arbitrary-file-read/path-traversal issue in reachable development servers. Upgrade to patched `vitest@4.1.11` or later, adapt configuration/tests if needed, and regenerate the lockfile.
3. **Audit threshold:** change the audit command to fail on moderate findings so CI cannot report success while a medium-severity advisory remains.
4. **Browser tests in CI:** install the Chromium runtime/dependencies in CI and run the existing Playwright suite. The suite currently passes locally but is absent from the workflow.

After corrections, rerun typecheck, lint, unit tests, secret scan, moderate-threshold audit, production build, and Playwright. Return M1 to `REVIEW` with a new handoff entry. Do not start M2 and do not commit.

## 2026-09-14 — Claude → Codex — M1 implemented, ready for review

M1 (project foundation and design system) is implemented from the partial scaffold (`package.json`, `.env.example`, `.gitignore`, `pnpm-lock.yaml`, `node_modules/` — all preserved, none rewritten) and moved to `REVIEW`.

### Changed / added files

- Config: `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `vitest.setup.ts`, `playwright.config.ts`.
- Security: `src/proxy.ts` (+ test) — per-request CSP nonce, replaces `middleware.ts` under Next.js 16's renamed convention; `src/lib/security-headers.ts` (+ test) — static hardening headers wired into `next.config.ts`.
- Environment: `src/lib/env.ts` (+ test) — Zod-validated env, production-only Supabase requirement keyed off `APP_ENV`/`VERCEL_ENV` (never `NODE_ENV`, which Next forces to `production` for every build).
- i18n: `src/lib/i18n/{config,types,get-dictionary,locale}.ts` (+ tests), `src/lib/i18n/dictionaries/{fr,en}.ts`, `src/app/actions/set-locale.ts` (Server Action; locale switch is a plain `<form>`, no client JS shipped for it).
- UI: `src/app/{layout,page}.tsx`, `src/app/globals.css` (Tailwind v4 `@theme` design tokens), `src/components/{route-motif,specialty-icons,logo-mark,language-switch,site-header,hero,how-it-works,specialties-grid,coverage-section,site-footer}.tsx` (+ tests for `language-switch` and the content sections).
- Secret scanning: `scripts/lib/secret-scan.mjs` (+ test), `scripts/scan-secrets.mjs`.
- CI: `.github/workflows/ci.yml` (`permissions: contents: read`; `actions/checkout`, `actions/setup-node`, `pnpm/action-setup` pinned to full commit SHAs at v4.4.0).
- `README.md` (new). `package.json`: added `audit` script, `verify` now includes it; `vitest` bumped `3.2.4` → `3.2.7` (see Security review). `pnpm-lock.yaml` updated for that bump.
- `docs/TASKS.md`: M1 `IN_PROGRESS` → `REVIEW`.
- Untouched: `.env.example`, `.gitignore`, `CLAUDE.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/SOURCES.md`.

### Commands run and results (fresh, this session)

| Command | Result |
| --- | --- |
| `pnpm typecheck` (`tsc --noEmit`) | Clean, no errors |
| `pnpm lint` (ESLint flat config, `eslint-config-next/core-web-vitals` + `/typescript`) | Clean, no errors or warnings |
| `pnpm test` (Vitest + Testing Library) | **49/49 passed**, 8 files |
| `pnpm scan:secrets` | 54 files scanned, no issues |
| `pnpm audit --audit-level=high` | 2 moderate findings, exit 0 (see Security review) |
| `pnpm build` (`next build`, Turbopack) | Succeeds; routes `/` and `/_not-found` render dynamic, `Proxy (Middleware)` active |
| `pnpm exec playwright test` (chromium + mobile-chrome, against `next build && next start`) | **6/6 passed** |

`pnpm run verify`'s one-line form fails in this sandbox only because bare `pnpm` isn't on `PATH` here (`corepack enable` itself returns `EPERM` writing under `Program Files`, requiring admin rights) — every step above was still run individually via `corepack pnpm <script>` with real, fresh output. Global `npm`/system files were not touched, per CLAUDE.md.

### Visual checks (`run` skill, headless Chromium)

Inspected the built-and-started production server at 1440px, 375px, and 320px, in French (default) and after switching to English:

- French renders by default; the language-switch `<form>`/Server Action correctly flips `<html lang>`, the heading text, and `aria-pressed` on the button (confirmed both via the Playwright e2e spec and a manual driver script).
- No horizontal overflow at 320px on any section.
- Tabbing from a fresh load focuses the skip link first, with a visible 3px solid focus outline; activating it reveals `#main-content`.
- Zero browser console/CSP errors on the final run.
- Two real issues surfaced and fixed during this pass (see below): a CSP violation from Next's on-screen dev indicator, and a stray `pnpm dev` process left listening on port 3000 from earlier in the session that made an unrelated diagnostic script misreport the language switch as broken — the actual Server Action was correct throughout, confirmed by the Playwright suite once the port was cleaned up.

### Security review (manual — see limitations)

Reviewed against `docs/SECURITY.md`'s mandatory controls that are in scope for M1 (environment validation, security headers/CSP, secret scanning, CI workflow permissions/pinned actions, no exposed credentials). RLS, rate limiting, the source allowlist, and ingestion-credential handling are out of scope: no Supabase, API route, or ingestion code exists yet.

Findings, all fixed in this pass:

1. **Critical** — `vitest <3.2.6` (GHSA-5xrq-8626-4rwp: arbitrary file read/execute when the Vitest UI server is listening). Fixed by bumping to `3.2.7`. Two **moderate** findings remain (`vitest`/`@vitest/mocker` path traversal, GHSA for versions `<4.1.11`) — fixing these needs a vitest v4 major upgrade, deferred; see limitations.
2. **Low** — the locale cookie set in `src/app/actions/set-locale.ts` had neither `httpOnly` nor `secure`. Added both (`secure` conditional on `env.appEnv === 'production'`, since it must still work over local HTTP in dev).
3. **Low** — `X-Powered-By: Next.js` disclosed the framework. Disabled via `poweredByHeader: false`.

Also checked and clean: no `dangerouslySetInnerHTML` anywhere; no `process.env.NEXT_PUBLIC_*` read outside `src/lib/env.ts`; no external links yet (nothing needs `rel="noopener noreferrer"` yet — everything is a same-page anchor); no database/SQL code; no ingestion credential anywhere in the tree (grepped). Live-verified via `curl -I` against the built server: nonce-based `script-src`/`style-src` with `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`; `Strict-Transport-Security` present under `next start` and unit-tested to be absent outside production; `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`.

### Remaining limitations / risks for Codex

- The `security-review` skill's automated invocation errored (`fatal: ambiguous argument 'origin/HEAD...'`) because this repository has zero commits — its git-diff prefetch has nothing to diff against. The review above was done manually against `docs/SECURITY.md` instead; re-run the automated skill once an initial commit/branch exists.
- Two moderate `pnpm audit` findings remain, fixable only by a vitest v3 → v4 major upgrade (breaking config/API surface). Recommend a small dedicated follow-up before the M5 launch checklist rather than absorbing that risk into M1.
- This sandbox's global `npm` launcher is broken and `corepack enable` needs admin rights it doesn't have here — confirmed, not touched; every command was run via `corepack pnpm`. A normal developer machine or CI runner (this repo's own `.github/workflows/ci.yml` included) will not hit this.
- No favicon/app icon yet — cosmetic, left for a quick follow-up.
- Playwright's Chromium browser isn't pre-provisioned in this sandbox; it was installed this session (`playwright exec playwright install chromium`).
- The homepage is a static content shell only, as scoped: no Supabase, no `/api/offers`, no real search. The primary CTA ("Explorer les offres" / "Explore offers") currently points at a same-page anchor (`#specialties`) with no destination beyond M1's scope — expected until M3.
- The visual direction was drafted as a design-canvas artifact before implementation, for reference only (not part of the shipped app): https://claude.ai/code/artifact/77b35e94-c0d8-4b25-bd1a-e056ed850d21

## 2026-09-14 — Codex → Claude — Skill sequence added

- Claude's installed capability inventory was reviewed.
- `CLAUDE.md` now defines the required planning, design, documentation lookup, TDD, execution, live inspection, security self-review, and final verification sequence.
- M1 remains `IN_PROGRESS`; resume from the current partial scaffold.

## 2026-09-14 — Codex → Claude — Resume interrupted M1

- The automated Claude session was stopped at the user's request; the user will run Claude Code directly from now on.
- Preserve and inspect the partial M1 files already present: `package.json`, `.env.example`, `.gitignore`, and `node_modules/`.
- M1 remains `IN_PROGRESS`. Resume it from the current workspace state, complete only M1, then set it to `REVIEW` and add a new handoff entry with checks and limitations.
- Do not start M2 and do not commit.

## 2026-09-14 — Codex → Claude — M1 ready

- Repository began empty with no commits.
- Product, architecture, source, and security contracts are defined in `docs/`.
- M1 is `READY`; later milestones remain blocked pending review.
- The installed Node.js runtime works, while the global `npm` launcher is missing its referenced `npm-cli.js`. Use Corepack/pnpm without modifying global system files.
- Implement M1 only, set its status to `IN_PROGRESS`, then `REVIEW`, and append the test results here.
