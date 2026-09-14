import { describe, expect, it } from 'vitest'
import { computeCanonicalUrlHash, stripTrackingParams, validateAllowlistedHttpsUrl } from './urls'

const ALLOWED_HOSTS = ['api.smartrecruiters.com', 'jobs.smartrecruiters.com']

describe('validateAllowlistedHttpsUrl', () => {
  it('accepts a valid allowlisted HTTPS URL', () => {
    const result = validateAllowlistedHttpsUrl('https://jobs.smartrecruiters.com/Inetum2/abc', ALLOWED_HOSTS)
    expect(result).toEqual({ ok: true, url: 'https://jobs.smartrecruiters.com/Inetum2/abc' })
  })

  it('rejects http', () => {
    expect(validateAllowlistedHttpsUrl('http://jobs.smartrecruiters.com/x', ALLOWED_HOSTS).ok).toBe(false)
  })

  it('rejects credential-bearing URLs', () => {
    expect(
      validateAllowlistedHttpsUrl('https://user:pass@api.smartrecruiters.com/x', ALLOWED_HOSTS).ok,
    ).toBe(false)
  })

  it('rejects localhost', () => {
    expect(validateAllowlistedHttpsUrl('https://localhost/x', ALLOWED_HOSTS).ok).toBe(false)
  })

  it('rejects a private IPv4 literal', () => {
    expect(validateAllowlistedHttpsUrl('https://10.0.0.5/x', ALLOWED_HOSTS).ok).toBe(false)
    expect(validateAllowlistedHttpsUrl('https://192.168.1.1/x', ALLOWED_HOSTS).ok).toBe(false)
    expect(validateAllowlistedHttpsUrl('https://127.0.0.1/x', ALLOWED_HOSTS).ok).toBe(false)
    expect(validateAllowlistedHttpsUrl('https://169.254.169.254/x', ALLOWED_HOSTS).ok).toBe(false)
  })

  it('rejects a host not on the allowlist', () => {
    expect(validateAllowlistedHttpsUrl('https://evil.example.com/x', ALLOWED_HOSTS).ok).toBe(false)
  })

  it('rejects a lookalike suffix-match host (exact match only)', () => {
    expect(
      validateAllowlistedHttpsUrl('https://api.smartrecruiters.com.attacker.com/x', ALLOWED_HOSTS).ok,
    ).toBe(false)
  })

  it('rejects a malformed URL string', () => {
    expect(validateAllowlistedHttpsUrl('not a url', ALLOWED_HOSTS).ok).toBe(false)
  })

  it('rejects an unsupported scheme', () => {
    expect(validateAllowlistedHttpsUrl('javascript:alert(1)', ALLOWED_HOSTS).ok).toBe(false)
    expect(validateAllowlistedHttpsUrl('data:text/html,<script>1</script>', ALLOWED_HOSTS).ok).toBe(false)
  })
})

describe('stripTrackingParams', () => {
  it('removes utm_* and known tracking params', () => {
    const result = stripTrackingParams(
      'https://jobs.smartrecruiters.com/Inetum2/abc?utm_source=x&utm_campaign=y&fbclid=z&gclid=w',
    )
    expect(result).toBe('https://jobs.smartrecruiters.com/Inetum2/abc')
  })

  it('keeps legitimate params', () => {
    const result = stripTrackingParams('https://jobs.smartrecruiters.com/Inetum2/abc?id=123&utm_source=x')
    expect(result).toBe('https://jobs.smartrecruiters.com/Inetum2/abc?id=123')
  })
})

describe('computeCanonicalUrlHash', () => {
  it('is stable for the same URL', () => {
    const url = 'https://jobs.smartrecruiters.com/Inetum2/abc'
    expect(computeCanonicalUrlHash(url)).toBe(computeCanonicalUrlHash(url))
  })

  it('is identical for URLs differing only by tracking params', () => {
    const withTracking = 'https://jobs.smartrecruiters.com/Inetum2/abc?utm_source=x'
    const without = 'https://jobs.smartrecruiters.com/Inetum2/abc'
    expect(computeCanonicalUrlHash(withTracking)).toBe(computeCanonicalUrlHash(without))
  })

  it('differs for a genuinely different path', () => {
    const a = computeCanonicalUrlHash('https://jobs.smartrecruiters.com/Inetum2/abc')
    const b = computeCanonicalUrlHash('https://jobs.smartrecruiters.com/Inetum2/xyz')
    expect(a).not.toBe(b)
  })
})
