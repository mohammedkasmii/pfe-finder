-- Idempotently seeds the three APPROVED_FOR_BUILD sources from
-- docs/SOURCES.md, so a fresh database is immediately runnable by the
-- collector without a separate manual seeding step. Safe to re-run: an
-- existing row's configuration is refreshed to match this migration, but
-- `enabled` is deliberately left out of the UPDATE SET list so a
-- maintainer's manual disable of a broken source survives re-running
-- migrations.
insert into public.sources (key, name, adapter, employer_identifier, attribution_url, allowed_hosts, countries, enabled)
values
  ('smartrecruiters-inetum', 'Inetum', 'smartrecruiters', 'Inetum2', 'https://jobs.smartrecruiters.com/Inetum2', array['api.smartrecruiters.com', 'jobs.smartrecruiters.com'], array['MA', 'FR'], true),
  ('smartrecruiters-devoteam', 'Devoteam', 'smartrecruiters', 'Devoteam', 'https://jobs.smartrecruiters.com/Devoteam', array['api.smartrecruiters.com', 'jobs.smartrecruiters.com'], array['FR'], true),
  ('smartrecruiters-mazars', 'Forvis Mazars', 'smartrecruiters', 'MAZARS', 'https://jobs.smartrecruiters.com/MAZARS', array['api.smartrecruiters.com', 'jobs.smartrecruiters.com'], array['MA', 'FR'], true)
on conflict (key) do update set
  name = excluded.name,
  adapter = excluded.adapter,
  employer_identifier = excluded.employer_identifier,
  attribution_url = excluded.attribution_url,
  allowed_hosts = excluded.allowed_hosts,
  countries = excluded.countries;
