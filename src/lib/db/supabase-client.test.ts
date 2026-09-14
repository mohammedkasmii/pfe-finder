import { describe, expect, it } from 'vitest'
import { loadSupabaseIngestionCredentials } from './supabase-client'

describe('loadSupabaseIngestionCredentials', () => {
  it('returns both values when present', () => {
    const creds = loadSupabaseIngestionCredentials({
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'a'.repeat(40),
    })
    expect(creds).toEqual({ supabaseUrl: 'https://project.supabase.co', serviceRoleKey: 'a'.repeat(40) })
  })

  it('throws a bounded error naming every missing variable, never a value', () => {
    expect(() => loadSupabaseIngestionCredentials({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
    expect(() => loadSupabaseIngestionCredentials({})).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('reports only the missing variable when one is present', () => {
    expect(() =>
      loadSupabaseIngestionCredentials({ NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})
