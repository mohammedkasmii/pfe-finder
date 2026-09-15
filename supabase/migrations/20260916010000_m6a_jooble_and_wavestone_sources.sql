-- M6A: Morocco-first source expansion — Jooble Morocco (API) and Wavestone
-- Morocco (SmartRecruiters). Forward-only, idempotent: does not edit
-- 20260914010500_seed_sources.sql or any other prior migration.
--
-- Both sources were reviewed and approved by Codex on 2026-09-16
-- (docs/SOURCES.md: both now APPROVED) and are inserted ENABLED
-- (enabled = true). `enabled` is deliberately excluded from the UPDATE SET
-- list (same pattern as 20260914010500_seed_sources.sql) so a
-- maintainer's later manual disable survives re-running this migration.
--
-- `jooble-morocco`'s `employer_identifier` is the fixed literal
-- 'ma.jooble.org' (there is no per-employer identifier for an aggregator
-- API) — see src/lib/sources/jooble/adapter.ts, which never reads this
-- column; the actual `JOOBLE_API_KEY` credential is loaded lazily from
-- `process.env` in collector-only code and is never part of this table or
-- any migration.
insert into public.sources (key, name, adapter, employer_identifier, attribution_url, allowed_hosts, countries, enabled)
values
  ('jooble-morocco', 'Jooble Morocco', 'jooble', 'ma.jooble.org', 'https://ma.jooble.org/', array['ma.jooble.org'], array['MA'], true),
  ('smartrecruiters-wavestone', 'Wavestone', 'smartrecruiters', 'Wavestone1', 'https://jobs.smartrecruiters.com/Wavestone1', array['api.smartrecruiters.com', 'jobs.smartrecruiters.com'], array['MA'], true)
on conflict (key) do update set
  name = excluded.name,
  adapter = excluded.adapter,
  employer_identifier = excluded.employer_identifier,
  attribution_url = excluded.attribution_url,
  allowed_hosts = excluded.allowed_hosts,
  countries = excluded.countries;
