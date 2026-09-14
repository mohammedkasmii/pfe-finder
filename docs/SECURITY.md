# Security specification

## Threat model

Protect against hostile search input, malicious markup and URLs from sources, scraping-triggered SSRF, automated request abuse, unauthorized database writes, leaked deployment secrets, dependency compromise, and partial ingestion corrupting availability state.

## Mandatory controls

- Enable Supabase row-level security on every public-schema table. Anonymous clients may select only active public offer fields and source freshness. They receive no insert, update, or delete policy.
- Use a dedicated ingestion credential stored only in GitHub Actions secrets. Never use it in client code, previews from forks, logs, screenshots, fixtures, or error messages.
- Validate environment variables at process start and all API parameters with strict schemas. Bound query length, filter length, page size, and cursor size.
- Apply IP-based rate limiting to `/api/offers`; fail safely when the limiter is unavailable and never expose database errors.
- Maintain a source-level HTTPS host allowlist. Resolve redirects manually and reject every destination outside the allowlist. Accept no user-supplied fetch destination.
- Strip scripts, styles, event attributes, forms, embeds, and tracking markup from external descriptions. Store/render plain text for V1.
- Accept application and source links only when HTTPS and allowlisted. Open external links with `noopener noreferrer`.
- Set Content-Security-Policy, Strict-Transport-Security in production, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and frame denial headers.
- Use parameterized database queries. Do not concatenate SQL from filters.
- Give GitHub workflows `contents: read` unless a documented task requires more. Pin third-party actions to full commit SHAs before launch.
- Keep ingestion workflows unavailable to `pull_request_target`. Treat changes to workflows, migrations, security docs, and source allowlists as security-sensitive review areas.
- Run type checking, linting, tests, production build, dependency audit, and secret scanning in CI.
- Redact tokens, connection strings, query values, descriptions, and stack traces from production logs. Retain only bounded operational metadata.

## Review tests

- Anonymous insert/update/delete attempts fail for all protected tables.
- SQL/script payloads in every filter are rejected or treated as inert text.
- Malicious source HTML is stored and rendered as harmless text.
- HTTP URLs, credential-bearing URLs, unsupported schemes, unexpected redirects, localhost, private IP destinations, and unapproved hosts are rejected.
- Oversized query, cursor, and page parameters return a controlled 400 response.
- Rate limits produce a controlled 429 response without affecting ordinary browsing.
- A timed-out or malformed source scan creates a failed run and leaves current offers active.
- Built browser assets and Git history contain no ingestion credential or database password.

## Launch checklist

- [ ] RLS policies reviewed against the deployed database
- [ ] Production headers verified over HTTPS
- [ ] GitHub and Vercel secrets reviewed by name and scope
- [ ] Workflow permissions and pinned actions reviewed
- [ ] Dependency audit and secret scan pass
- [ ] Source allowlists match `docs/SOURCES.md`
- [ ] Error pages and logs disclose no internals
- [ ] Manual ingestion and rollback/recovery procedure verified
