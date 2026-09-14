import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface SupabaseIngestionCredentials {
  supabaseUrl: string
  serviceRoleKey: string
}

/**
 * Loads the two values the collector needs directly from `process.env`,
 * deliberately independent of `src/lib/env.ts`'s validation path. That
 * module exists to validate what the *browser-facing* Next.js app reads;
 * `SUPABASE_SERVICE_ROLE_KEY` must never be reachable from that code path
 * at all, so it gets its own tiny loader here instead of being folded into
 * the shared `env` singleton.
 */
export function loadSupabaseIngestionCredentials(
  source: Record<string, string | undefined> = process.env,
): SupabaseIngestionCredentials {
  const supabaseUrl = source.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = source.SUPABASE_SERVICE_ROLE_KEY
  const issues: string[] = []
  if (!supabaseUrl) issues.push('NEXT_PUBLIC_SUPABASE_URL is required for ingestion')
  if (!serviceRoleKey) issues.push('SUPABASE_SERVICE_ROLE_KEY is required for ingestion')
  if (issues.length > 0) {
    throw new Error(`Invalid ingestion configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`)
  }
  return { supabaseUrl: supabaseUrl!, serviceRoleKey: serviceRoleKey! }
}

export function createSupabaseIngestionClient(credentials: SupabaseIngestionCredentials): SupabaseClient {
  return createClient(credentials.supabaseUrl, credentials.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
