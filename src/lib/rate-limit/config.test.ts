import { describe, expect, it } from 'vitest'
import { loadRateLimitConfig, parseUpstashConfig } from './config'

describe('parseUpstashConfig (shared by env.ts and limiter.ts)', () => {
  it('is "absent" when both values are missing', () => {
    expect(parseUpstashConfig(undefined, undefined)).toEqual({ kind: 'absent' })
  })

  it('is "absent" when both values are empty/whitespace-only', () => {
    expect(parseUpstashConfig('', '  ')).toEqual({ kind: 'absent' })
  })

  it('is "invalid" when only the URL is present', () => {
    expect(parseUpstashConfig('https://x.upstash.io', undefined).kind).toBe('invalid')
  })

  it('is "invalid" when only the token is present', () => {
    expect(parseUpstashConfig(undefined, 'token').kind).toBe('invalid')
  })

  // Exact adversarial values from the newest HANDOFF entry.
  it('is "invalid" for a bare "https://" with a token (previously accepted)', () => {
    expect(parseUpstashConfig('https://', 'x').kind).toBe('invalid')
  })

  it('is "invalid" for a credential-bearing URL (previously accepted)', () => {
    expect(parseUpstashConfig('https://user:pass@x.upstash.io', 'token').kind).toBe('invalid')
  })

  it('is "invalid" for a valid-looking URL with a whitespace-only token (previously accepted)', () => {
    expect(parseUpstashConfig('https://x.upstash.io', '   ').kind).toBe('invalid')
  })

  it('is "invalid" for a non-HTTPS URL', () => {
    expect(parseUpstashConfig('http://x.upstash.io', 'token').kind).toBe('invalid')
  })

  it('is "invalid" for a host that is not an upstash.io subdomain', () => {
    expect(parseUpstashConfig('https://evil.example.com', 'token').kind).toBe('invalid')
  })

  it('is "invalid" for an unparseable URL', () => {
    expect(parseUpstashConfig('not a url', 'token').kind).toBe('invalid')
  })

  it('is "valid" for a well-formed HTTPS upstash.io URL and non-blank token', () => {
    const result = parseUpstashConfig('https://us1-example-12345.upstash.io', 'real-token')
    expect(result).toEqual({ kind: 'valid', url: 'https://us1-example-12345.upstash.io/', token: 'real-token' })
  })

  it('trims surrounding whitespace from both values before validating', () => {
    const result = parseUpstashConfig('  https://x.upstash.io  ', '  token  ')
    expect(result.kind).toBe('valid')
    if (result.kind === 'valid') expect(result.token).toBe('token')
  })
})

describe('loadRateLimitConfig (runtime accessor)', () => {
  it('returns null when both env vars are missing', () => {
    expect(loadRateLimitConfig({})).toBeNull()
  })

  it('returns null when only the URL is present', () => {
    expect(loadRateLimitConfig({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io' })).toBeNull()
  })

  it('returns null when only the token is present', () => {
    expect(loadRateLimitConfig({ UPSTASH_REDIS_REST_TOKEN: 'token' })).toBeNull()
  })

  it('returns null when the URL is not https', () => {
    expect(
      loadRateLimitConfig({ UPSTASH_REDIS_REST_URL: 'http://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'token' }),
    ).toBeNull()
  })

  it('returns null for a credential-bearing URL', () => {
    expect(
      loadRateLimitConfig({
        UPSTASH_REDIS_REST_URL: 'https://user:pass@x.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'token',
      }),
    ).toBeNull()
  })

  it('returns null for a non-upstash.io host', () => {
    expect(
      loadRateLimitConfig({ UPSTASH_REDIS_REST_URL: 'https://evil.example.com', UPSTASH_REDIS_REST_TOKEN: 'token' }),
    ).toBeNull()
  })

  it('returns null for a whitespace-only token', () => {
    expect(
      loadRateLimitConfig({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: '   ' }),
    ).toBeNull()
  })

  it('returns the config when both are valid', () => {
    expect(
      loadRateLimitConfig({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'token' }),
    ).toEqual({ url: 'https://x.upstash.io/', token: 'token' })
  })
})
