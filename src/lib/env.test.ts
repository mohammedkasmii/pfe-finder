import { describe, expect, it } from 'vitest'
import { EnvValidationError, loadEnv } from './env'

describe('loadEnv', () => {
  it('defaults to development with empty Supabase values when nothing is set', () => {
    const env = loadEnv({})
    expect(env.appEnv).toBe('development')
    expect(env.siteUrl).toBe('http://localhost:3000')
    expect(env.supabaseUrl).toBe('')
    expect(env.supabaseAnonKey).toBe('')
  })

  it('detects production via VERCEL_ENV and requires Supabase values', () => {
    expect(() => loadEnv({ VERCEL_ENV: 'production' })).toThrow(EnvValidationError)
  })

  it('lets an explicit APP_ENV override VERCEL_ENV', () => {
    const env = loadEnv({
      APP_ENV: 'production',
      VERCEL_ENV: 'preview',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
      NEXT_PUBLIC_SITE_URL: 'https://pfe-finder.example.com',
    })
    expect(env.appEnv).toBe('production')
    expect(env.supabaseUrl).toBe('https://project.supabase.co')
    expect(env.supabaseAnonKey).toBe('a'.repeat(40))
    expect(env.siteUrl).toBe('https://pfe-finder.example.com')
  })

  it('accepts a fully configured production environment', () => {
    const env = loadEnv({
      APP_ENV: 'production',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
      NEXT_PUBLIC_SITE_URL: 'https://pfe-finder.example.com',
    })
    expect(env).toEqual({
      appEnv: 'production',
      supabaseUrl: 'https://project.supabase.co',
      supabaseAnonKey: 'a'.repeat(40),
      siteUrl: 'https://pfe-finder.example.com',
    })
  })

  it('rejects an http site URL in production', () => {
    expect(() =>
      loadEnv({
        APP_ENV: 'production',
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
        NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      }),
    ).toThrow(EnvValidationError)
  })

  it('tolerates an http localhost site URL in development', () => {
    const env = loadEnv({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })
    expect(env.siteUrl).toBe('http://localhost:3000')
  })

  it('rejects an http Supabase URL on a non-localhost host', () => {
    expect(() => loadEnv({ NEXT_PUBLIC_SUPABASE_URL: 'http://project.supabase.co' })).toThrow(
      EnvValidationError,
    )
  })

  it('rejects a Supabase anon key that is too short even outside production', () => {
    expect(() =>
      loadEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'short',
      }),
    ).toThrow(EnvValidationError)
  })

  it('rejects a malformed NEXT_PUBLIC_SITE_URL regardless of environment', () => {
    expect(() => loadEnv({ NEXT_PUBLIC_SITE_URL: 'not-a-url' })).toThrow(EnvValidationError)
  })

  it('rejects an invalid APP_ENV value', () => {
    expect(() => loadEnv({ APP_ENV: 'staging' })).toThrow(EnvValidationError)
  })

  it('rejects any NEXT_PUBLIC_-prefixed variable that looks credential-shaped', () => {
    expect(() =>
      loadEnv({
        NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'a'.repeat(40),
      }),
    ).toThrow(EnvValidationError)
  })
})
