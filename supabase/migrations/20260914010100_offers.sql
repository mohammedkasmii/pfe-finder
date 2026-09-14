create table public.offers (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references public.sources(key),
  external_id text not null,
  source_url text not null,
  apply_url text not null,
  canonical_url_hash text not null,
  title text not null,
  company text not null,
  description_text text not null default '',
  country text not null,
  city text,
  region text,
  work_mode text not null default 'unknown',
  internship_type text not null default 'internship',
  is_pfe boolean not null default false,
  specialties text[] not null default '{}',
  technologies text[] not null default '{}',
  language text not null,
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  inactive_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint offers_source_external_unique unique (source_key, external_id),
  constraint offers_country_valid check (country in ('MA','FR')),
  constraint offers_status_valid check (status in ('active','inactive')),
  constraint offers_work_mode_valid check (work_mode in ('onsite','hybrid','remote','unknown')),
  -- V1 only ever classifies computer-science internships; non-internship
  -- roles are rejected before persistence (docs/PRODUCT.md). The column
  -- (per docs/ARCHITECTURE.md) is kept distinct from a hardcoded constant
  -- so a future internship sub-type doesn't require a schema migration.
  constraint offers_internship_type_valid check (internship_type in ('internship')),
  constraint offers_language_valid check (language in ('fr','en')),
  constraint offers_source_url_https check (source_url ~ '^https://'),
  constraint offers_apply_url_https check (apply_url ~ '^https://'),
  constraint offers_title_not_blank check (length(btrim(title)) > 0),
  constraint offers_company_not_blank check (length(btrim(company)) > 0),
  constraint offers_inactive_at_requires_inactive check (
    (status = 'inactive') or (inactive_at is null)
  )
);

comment on table public.offers is
  'Normalized internship postings. Rows are only ever written by the ingestion collector (service role); anon reads are restricted to status = active by RLS (see the RLS migration).';

create index offers_active_published_idx on public.offers (published_at desc) where status = 'active';
create index offers_active_country_idx on public.offers (country) where status = 'active';
create index offers_active_city_idx on public.offers (city) where status = 'active';
create index offers_active_pfe_idx on public.offers (is_pfe) where status = 'active';
create index offers_specialties_gin_idx on public.offers using gin (specialties);
create index offers_technologies_gin_idx on public.offers using gin (technologies);
create index offers_canonical_url_hash_idx on public.offers (canonical_url_hash);

create trigger offers_set_updated_at
  before update on public.offers
  for each row execute function public.set_updated_at();
