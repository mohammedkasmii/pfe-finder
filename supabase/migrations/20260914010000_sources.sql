-- Configured ingestion sources. Written only by the service-role ingestion
-- credential (GitHub Actions secret), never by the browser.
create table public.sources (
  key text primary key,
  name text not null,
  adapter text not null,
  employer_identifier text not null,
  attribution_url text not null,
  allowed_hosts text[] not null default '{}',
  countries text[] not null default '{}',
  enabled boolean not null default true,
  last_success_at timestamptz,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sources_key_format check (key ~ '^[a-z0-9-]+$'),
  constraint sources_countries_valid check (countries <@ array['MA','FR']::text[]),
  constraint sources_attribution_url_https check (attribution_url ~ '^https://')
);

comment on table public.sources is
  'Configured ingestion sources. Written only by the service-role ingestion credential (GitHub Actions secret), never by the browser.';

-- Shared trigger function: bump updated_at on every row update. Reused by
-- offers in the next migration.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sources_set_updated_at
  before update on public.sources
  for each row execute function public.set_updated_at();
