create or replace function public.cleanup_inactive_offers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.offers
  where status = 'inactive'
    and inactive_at is not null
    and inactive_at < now() - interval '30 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

comment on function public.cleanup_inactive_offers() is
  'Deletes offers inactive for more than 30 days. Run on a schedule (e.g. Supabase pg_cron, or a maintainer-triggered call) using the service role. Never exposed to anon or authenticated.';

revoke all on function public.cleanup_inactive_offers() from public, anon, authenticated;
-- The comment above documents "using the service role", but until this
-- explicit grant existed there was no privilege backing that — confirmed
-- for real: service_role got "permission denied for function
-- cleanup_inactive_offers". BYPASSRLS bypasses row-level security
-- policies, not function-level EXECUTE privilege.
grant execute on function public.cleanup_inactive_offers() to service_role;
