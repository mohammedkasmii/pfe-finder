# PFE Finder — Claude Code Instructions

Read every file in `docs/` before changing application code.

## Working agreement

- Claude owns implementation and visual design. Codex owns architecture, source validation, security review, and milestone acceptance.
- Work only on tasks marked `READY` or `CHANGES_REQUESTED` and assigned to Claude in `docs/TASKS.md`.
- Complete one milestone at a time. Do not begin a dependent milestone until Codex marks its dependency `ACCEPTED`.
- Before coding, change the task to `IN_PROGRESS`. When complete, change it to `REVIEW` and append a concise entry to `docs/HANDOFF.md` with changed files, commands run, results, and remaining risks.
- Never rewrite or delete earlier handoff entries.
- Do not weaken a requirement in `docs/SECURITY.md`. If a requirement conflicts with implementation, stop and document the conflict.
- Preserve unrelated user changes. Never use destructive Git commands.

## Engineering rules

- Use Next.js App Router, TypeScript in strict mode, Tailwind CSS, and Supabase PostgreSQL.
- Prefer server components. Add client components only for interactive UI such as filters, language switching, and favorites.
- Validate all external data and request parameters. Treat scraped content as hostile.
- Never expose ingestion or database write credentials to browser code.
- Keep the UI bilingual. French is the default; source offer content is never machine-translated.
- Use accessible semantic HTML, visible focus states, keyboard navigation, and responsive layouts.
- Run the checks required by the current task before requesting review.

## Package manager

The machine has Node.js, but its global `npm` launcher may be broken. Prefer Corepack with `pnpm`, pin the package manager in `package.json`, and document any environment issue rather than changing global system files.

## Required skill sequence

For each milestone, use only skills that materially apply and follow their instructions:

1. `superpowers:writing-plans` to translate the ready milestone into a bounded execution checklist.
2. `design` for user-facing layout and visual-system work.
3. Context7 MCP for current official framework and library documentation.
4. `superpowers:test-driven-development` while implementing behavior.
5. `superpowers:executing-plans` to complete the accepted checklist.
6. `run` to launch and inspect user-facing work when an application shell exists.
7. `security-review` for a pre-handoff self-review of security-sensitive changes.
8. `superpowers:verification-before-completion` before changing a task to `REVIEW`.

Do not use `project-bootstrap` to replace this file or the contracts in `docs/`. Do not use parallel-agent or subagent-driven skills in the shared checkout unless the task board explicitly authorizes them.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
