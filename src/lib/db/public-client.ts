import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '../env'

let cachedClient: SupabaseClient | null = null

/**
 * The web application's ONLY Supabase client: built from the public anon
 * key, so every read it performs is bound by row-level security (see
 * supabase/migrations/20260914010300_rls.sql — anon may select only
 * active offers and source freshness fields). This module — and every
 * file it depends on — must never import `SUPABASE_SERVICE_ROLE_KEY` or
 * `src/lib/db/supabase-client.ts` (that client is for the ingestion
 * collector only, invoked from GitHub Actions, never from `src/app/**`),
 * and must never import fixture/fake-data infrastructure either — the
 * deterministic Playwright test data lives entirely under `e2e/`
 * (`e2e/test-server/`) as a separate local HTTP server the app is
 * pointed at via `NEXT_PUBLIC_SUPABASE_URL`, not via any branch or
 * import in this file (M3 review: a prior version of this module
 * statically imported a fake client and fictional offers, which then
 * shipped inside the production build's `.next/server` output).
 */
export function getPublicSupabaseClient(): SupabaseClient {
  cachedClient ??= createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cachedClient
}
