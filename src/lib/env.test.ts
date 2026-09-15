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

  it('defaults cursorSecret to a fixed, non-empty development value when unset outside production', () => {
    const env = loadEnv({})
    expect(env.cursorSecret.length).toBeGreaterThanOrEqual(32)
  })

  it('accepts an explicit CURSOR_SECRET outside production as long as it meets the length bound', () => {
    const env = loadEnv({ CURSOR_SECRET: 'd'.repeat(32) })
    expect(env.cursorSecret).toBe('d'.repeat(32))
  })

  it('rejects production when CURSOR_SECRET is missing', () => {
    expect(() =>
      loadEnv({
        APP_ENV: 'production',
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
        NEXT_PUBLIC_SITE_URL: 'https://pfe-finder.example.com',
      }),
    ).toThrow(EnvValidationError)
  })

  it('rejects production when CURSOR_SECRET is shorter than 32 characters', () => {
    expect(() =>
      loadEnv({
        APP_ENV: 'production',
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
        NEXT_PUBLIC_SITE_URL: 'https://pfe-finder.example.com',
        CURSOR_SECRET: 'short',
      }),
    ).toThrow(EnvValidationError)
  })

  it('detects production via VERCEL_ENV and requires Supabase values', () => {
    expect(() => loadEnv({ VERCEL_ENV: 'production' })).toThrow(EnvValidationError)
  })

  it('never lets APP_ENV=development downgrade a real Vercel production deployment (M3 review)', () => {
    // The exact reproduction: VERCEL_ENV=production + APP_ENV=development
    // with nothing else set previously resolved to a fully-valid
    // development environment (no throw) — silently disabling every
    // production-only requirement (Supabase, cursor secret, mandatory
    // rate limiting) on a real production deployment. It must now throw
    // for the same reason `VERCEL_ENV=production` alone throws above:
    // appEnv resolves to 'production' regardless of APP_ENV.
    expect(() => loadEnv({ VERCEL_ENV: 'production', APP_ENV: 'development' })).toThrow(EnvValidationError)
  })

  it('resolves appEnv to production (not development) when VERCEL_ENV=production and APP_ENV=development, even with a fully valid config', () => {
    const env = loadEnv({
      VERCEL_ENV: 'production',
      APP_ENV: 'development',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
      NEXT_PUBLIC_SITE_URL: 'https://pfe-finder.example.com',
      CURSOR_SECRET: 'c'.repeat(32),
      UPSTASH_REDIS_REST_URL: 'https://x.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token',
    })
    expect(env.appEnv).toBe('production')
  })

  it('lets an explicit APP_ENV override VERCEL_ENV', () => {
    const env = loadEnv({
      APP_ENV: 'production',
      VERCEL_ENV: 'preview',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
      NEXT_PUBLIC_SITE_URL: 'https://pfe-finder.example.com',
      CURSOR_SECRET: 'c'.repeat(32),
      UPSTASH_REDIS_REST_URL: 'https://x.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token',
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
      CURSOR_SECRET: 'c'.repeat(32),
      UPSTASH_REDIS_REST_URL: 'https://x.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token',
    })
    expect(env).toEqual({
      appEnv: 'production',
      supabaseUrl: 'https://project.supabase.co',
      supabaseAnonKey: 'a'.repeat(40),
      siteUrl: 'https://pfe-finder.example.com',
      cursorSecret: 'c'.repeat(32),
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

  const validProductionBase = {
    APP_ENV: 'production',
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
    NEXT_PUBLIC_SITE_URL: 'https://pfe-finder.example.com',
    CURSOR_SECRET: 'c'.repeat(32),
  }

  describe('mandatory production rate limiting (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)', () => {
    it('rejects production with neither Upstash variable set', () => {
      expect(() => loadEnv(validProductionBase)).toThrow(EnvValidationError)
    })

    it('rejects production with only the URL set', () => {
      expect(() =>
        loadEnv({ ...validProductionBase, UPSTASH_REDIS_REST_URL: 'https://x.upstash.io' }),
      ).toThrow(EnvValidationError)
    })

    it('rejects production with only the token set', () => {
      expect(() => loadEnv({ ...validProductionBase, UPSTASH_REDIS_REST_TOKEN: 'token' })).toThrow(
        EnvValidationError,
      )
    })

    it('rejects production with a non-HTTPS Upstash URL', () => {
      expect(() =>
        loadEnv({
          ...validProductionBase,
          UPSTASH_REDIS_REST_URL: 'http://x.upstash.io',
          UPSTASH_REDIS_REST_TOKEN: 'token',
        }),
      ).toThrow(EnvValidationError)
    })

    // Exact adversarial values from the newest HANDOFF entry, previously
    // accepted as valid production configuration.
    it('rejects production with a bare "https://" URL and a short token', () => {
      expect(() =>
        loadEnv({ ...validProductionBase, UPSTASH_REDIS_REST_URL: 'https://', UPSTASH_REDIS_REST_TOKEN: 'x' }),
      ).toThrow(EnvValidationError)
    })

    it('rejects production with a credential-bearing Upstash URL', () => {
      expect(() =>
        loadEnv({
          ...validProductionBase,
          UPSTASH_REDIS_REST_URL: 'https://user:pass@x.upstash.io',
          UPSTASH_REDIS_REST_TOKEN: 'token',
        }),
      ).toThrow(EnvValidationError)
    })

    it('rejects production with a valid-looking URL and a whitespace-only token', () => {
      expect(() =>
        loadEnv({ ...validProductionBase, UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: '   ' }),
      ).toThrow(EnvValidationError)
    })

    it('rejects production with a non-upstash.io host', () => {
      expect(() =>
        loadEnv({ ...validProductionBase, UPSTASH_REDIS_REST_URL: 'https://evil.example.com', UPSTASH_REDIS_REST_TOKEN: 'token' }),
      ).toThrow(EnvValidationError)
    })

    it('accepts production with both Upstash variables complete and valid', () => {
      expect(() =>
        loadEnv({
          ...validProductionBase,
          UPSTASH_REDIS_REST_URL: 'https://x.upstash.io',
          UPSTASH_REDIS_REST_TOKEN: 'token',
        }),
      ).not.toThrow()
    })

    it('allows development/test to omit both Upstash variables entirely', () => {
      expect(() => loadEnv({})).not.toThrow()
    })

    it('rejects development with only one of the pair set (partial config fails even outside production)', () => {
      expect(() => loadEnv({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io' })).toThrow(EnvValidationError)
      expect(() => loadEnv({ UPSTASH_REDIS_REST_TOKEN: 'token' })).toThrow(EnvValidationError)
    })

    it('rejects development with a non-HTTPS Upstash URL even when both are set', () => {
      expect(() =>
        loadEnv({ UPSTASH_REDIS_REST_URL: 'http://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'token' }),
      ).toThrow(EnvValidationError)
    })

    it('accepts development with both Upstash variables complete and valid', () => {
      expect(() =>
        loadEnv({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'token' }),
      ).not.toThrow()
    })
  })
})
