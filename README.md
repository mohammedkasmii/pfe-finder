# PFE Finder

Computer science internship search for Morocco and France. See `docs/` for
the product, architecture, source, and security specifications, and
`docs/TASKS.md` for delivery status.

This repository currently implements **M1 — project foundation and design
system**: a Next.js App Router shell with strict TypeScript, Tailwind CSS,
environment validation, security headers, and a bilingual (French default /
English) marketing homepage. No offer data, database, or ingestion exists
yet — that is M2 and later.

## Requirements

- Node.js ≥ 20.9 with [Corepack](https://nodejs.org/api/corepack.html)
  enabled (`corepack enable`). This project pins `pnpm@10.18.0` via
  `packageManager` in `package.json`; do not use the machine's global `npm`.

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
| `pnpm verify` | Runs all of the above (except `test:e2e`) plus the build |

## Project structure

- `src/app` — App Router routes, layout, and Server Actions.
- `src/components` — presentational, server-rendered UI components.
- `src/lib/env.ts` — environment variable validation (see file header).
- `src/lib/i18n` — bilingual dictionaries and locale helpers.
- `src/lib/security-headers.ts`, `src/proxy.ts` — security headers and the
  per-request CSP nonce.
- `scripts/` — repository maintenance scripts (currently secret scanning).
- `e2e/` — Playwright end-to-end specs.
