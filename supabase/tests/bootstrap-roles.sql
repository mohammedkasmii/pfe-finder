-- A hosted Supabase project provisions the `anon`/`authenticated`/
-- `service_role` roles automatically. A plain Postgres instance (e.g.
-- `docker run postgres:17-alpine`, used to verify migrations without the
-- full Supabase CLI/Docker stack) does not — this script creates them
-- with the same key property (`service_role` has BYPASSRLS) so
-- supabase/migrations/*.sql and supabase/tests/rls.sql behave the same
-- way they would against a real Supabase database. Idempotent: safe to
-- run more than once.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
