-- The M3 public search surface. A single parameterized SQL function does
-- every filter/sort/keyset-pagination decision server-side, so the
-- TypeScript layer (src/lib/offers/search-offers.ts) never has to build a
-- PostgREST `.or()`/`in`/filter-grammar string from user input — the exact
-- pattern docs/SECURITY.md and M2's finalize functions already established
-- for "parameterized database operations only".
--
-- `security invoker` (the default — not specified means invoker) is
-- deliberate: this function must run under the CALLING role's own
-- permissions and RLS, not bypass them. Called via the anon key, it is
-- therefore automatically bound by "anon can read active offers" (see
-- 20260914010300_rls.sql) even before its own `status = 'active'` clause
-- is considered — the clause below is defense in depth, not the only
-- thing standing between anon and inactive offers.

create or replace function public.escape_ilike_pattern(p_value text)
returns text
language sql
immutable
as $$
  -- Escapes ILIKE's own wildcard characters (and the escape character
  -- itself) so a user's literal `%` or `_` in a search/city value is
  -- matched as a literal character, not treated as a wildcard.
  select replace(replace(replace(p_value, '\', '\\'), '%', '\%'), '_', '\_');
$$;

revoke all on function public.escape_ilike_pattern(text) from public;
grant execute on function public.escape_ilike_pattern(text) to anon;

-- Defense in depth (M3 second correction round): `anon` can call this
-- function directly over PostgREST, bypassing GET /api/offers's Zod
-- validation entirely. Every input is therefore sanitized HERE too, not
-- just at the TypeScript boundary — a `with` CTE computes a clamped/
-- validated copy of every parameter before it's ever used in the WHERE
-- clause, so a malformed direct RPC call degrades safely (an out-of-range
-- value is clamped or the filter is dropped) rather than erroring,
-- crashing, or returning something surprising. `language sql` functions
-- can't `raise exception` conditionally, and "safely clamp" is the
-- explicitly documented alternative to strict rejection for this
-- function — an invalid enum-shaped filter (e.g. country='XX') is
-- dropped (treated as "no filter on this field"), never trusted as-is.
create or replace function public.search_offers(
  p_query text,
  p_country text,
  p_city text,
  p_specialty text,
  p_technology text,
  p_work_mode text,
  p_pfe boolean,
  p_language text,
  p_sort text,
  p_cursor_value timestamptz,
  p_cursor_id uuid,
  p_limit integer
)
returns setof public.offers
language sql
stable
set search_path = public
as $$
  with sanitized as (
    select
      -- Bounds mirror src/lib/offers/query-schema.ts exactly: q <=100,
      -- city <=80, technology <=40. left() truncates rather than
      -- rejecting; nullif(...,'') turns an empty-after-truncation value
      -- into "no filter" instead of an always-true '%%' pattern.
      nullif(left(p_query, 100), '') as query,
      case when p_country in ('MA', 'FR') then p_country else null end as country,
      nullif(left(p_city, 80), '') as city,
      -- Mirrors SPECIALTY_SLUGS (src/lib/ingestion/dictionaries/specialties.ts).
      case
        when p_specialty in ('software-web-mobile', 'data-ai', 'cybersecurity', 'cloud-devops', 'systems-networks', 'qa-testing')
        then p_specialty else null
      end as specialty,
      nullif(left(p_technology, 40), '') as technology,
      case when p_work_mode in ('onsite', 'hybrid', 'remote', 'unknown') then p_work_mode else null end as work_mode,
      p_pfe as pfe,
      case when p_language in ('fr', 'en') then p_language else null end as language,
      case when p_sort = 'recently-seen' then 'recently-seen' else 'newest' end as sort,
      -- The cursor value/id pair must be both-null or both-present — a
      -- caller supplying only one is treated as "no cursor" (start from
      -- page 1) rather than an ill-defined half-cursor.
      case when p_cursor_value is not null and p_cursor_id is not null then p_cursor_value end as cursor_value,
      case when p_cursor_value is not null and p_cursor_id is not null then p_cursor_id end as cursor_id,
      -- The server always requests limit+1 for a max UI limit of 24, so
      -- 25 is the hard ceiling regardless of what a direct RPC call asks
      -- for; a null/zero/negative request clamps up to a sane default.
      least(greatest(coalesce(p_limit, 13), 1), 25) as limit_value
  )
  select o.*
  from public.offers o, sanitized s
  where o.status = 'active'
    and (s.country is null or o.country = s.country)
    and (s.city is null or o.city ilike '%' || public.escape_ilike_pattern(s.city) || '%' escape '\')
    and (s.specialty is null or o.specialties @> array[s.specialty])
    and (s.technology is null or o.technologies @> array[s.technology])
    and (s.work_mode is null or o.work_mode = s.work_mode)
    and (s.pfe is null or o.is_pfe = s.pfe)
    and (s.language is null or o.language = s.language)
    and (
      s.query is null
      or o.title ilike '%' || public.escape_ilike_pattern(s.query) || '%' escape '\'
      or o.company ilike '%' || public.escape_ilike_pattern(s.query) || '%' escape '\'
      or o.city ilike '%' || public.escape_ilike_pattern(s.query) || '%' escape '\'
      -- docs/PRODUCT.md: "search title, company, city, specialty, and
      -- technology". unnest()+ilike over both arrays together (rather
      -- than array_to_string, which could create false-positive matches
      -- across a concatenation boundary) matches a specialty slug or a
      -- technology name as its own literal element.
      or exists (
        select 1 from unnest(o.specialties || o.technologies) as tag
        where tag ilike '%' || public.escape_ilike_pattern(s.query) || '%' escape '\'
      )
    )
    and (
      s.cursor_id is null
      or (s.sort = 'recently-seen' and (o.last_seen_at, o.id) < (s.cursor_value, s.cursor_id))
      or (s.sort <> 'recently-seen' and (coalesce(o.published_at, o.first_seen_at), o.id) < (s.cursor_value, s.cursor_id))
    )
  order by
    (case when s.sort = 'recently-seen' then o.last_seen_at else coalesce(o.published_at, o.first_seen_at) end) desc,
    o.id desc
  limit (select limit_value from sanitized);
$$;

comment on function public.search_offers(text,text,text,text,text,text,boolean,text,text,timestamptz,uuid,integer) is
  'Public read-only search over active offers. security invoker (default) — runs under the calling anon role, so RLS still applies. The caller always passes p_limit = requested_limit + 1 to detect a next page without a second COUNT query.';

revoke all on function public.search_offers(text,text,text,text,text,text,boolean,text,text,timestamptz,uuid,integer) from public;
grant execute on function public.search_offers(text,text,text,text,text,text,boolean,text,text,timestamptz,uuid,integer) to anon;
