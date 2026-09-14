import { describe, expect, it } from 'vitest'
import { boundedErrorSummary } from './error-summary'

describe('boundedErrorSummary', () => {
  it('passes short, benign messages through unchanged', () => {
    expect(boundedErrorSummary('listing fetch failed: timeout')).toBe('listing fetch failed: timeout')
  })

  it('truncates to 500 characters', () => {
    expect(boundedErrorSummary('x'.repeat(600))).toHaveLength(500)
  })

  it('redacts a JWT-shaped substring', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const result = boundedErrorSummary(`token was ${jwt}`)
    expect(result).not.toContain(jwt)
    expect(result).toContain('[redacted]')
  })

  it('redacts a bearer-token-shaped substring', () => {
    const result = boundedErrorSummary('auth header: Bearer abc123def456')
    expect(result).not.toContain('abc123def456')
  })

  it('collapses newlines so multiline stack-like content cannot reach a single log line', () => {
    const stack = 'Error: boom\n    at Object.<anonymous> (/app/src/index.js:1:1)\n    at Module._compile'
    const result = boundedErrorSummary(stack)
    expect(result).not.toContain('\n')
  })

  it('collapses carriage returns and tabs too', () => {
    const result = boundedErrorSummary('line one\r\nline two\tindented')
    expect(result).not.toMatch(/[\r\n\t]/)
  })

  it('redacts userinfo credentials from a URL (covers connection strings too)', () => {
    const result = boundedErrorSummary('failed to connect to postgres://dbuser:s3cr3t@db.internal:5432/prod')
    expect(result).not.toContain('dbuser:s3cr3t')
    expect(result).not.toContain('s3cr3t')
  })

  it('redacts userinfo credentials from an https URL', () => {
    const result = boundedErrorSummary('request to https://apikey:supersecret@api.example.com/v1/resource failed')
    expect(result).not.toContain('supersecret')
  })

  it('redacts the query string of a URL, not just its host/path', () => {
    const result = boundedErrorSummary(
      'GET https://api.smartrecruiters.com/v1/companies/Inetum2/postings?access_token=abc123&offset=0 failed',
    )
    expect(result).not.toContain('abc123')
  })

  // Adversarial cases confirmed against a real run: these previously
  // passed through boundedErrorSummary completely unredacted.
  it('redacts the query string of a non-HTTP connection URI', () => {
    const result = boundedErrorSummary('failed to connect: postgres://db.example/pfe?password=super-secret')
    expect(result).not.toContain('super-secret')
    expect(result).toContain('postgres://db.example/pfe?[redacted]')
  })

  it('redacts a standalone password= assignment outside any URL', () => {
    const result = boundedErrorSummary('config error: password=super-secret is invalid')
    expect(result).not.toContain('super-secret')
    expect(result).toContain('password=[redacted]')
  })

  it('redacts a standalone token= assignment outside any URL', () => {
    const result = boundedErrorSummary('auth failed: token=super-secret rejected')
    expect(result).not.toContain('super-secret')
    expect(result).toContain('token=[redacted]')
  })

  it('redacts standalone api_key= and apikey= assignments outside any URL', () => {
    expect(boundedErrorSummary('api_key=super-secret')).toBe('api_key=[redacted]')
    expect(boundedErrorSummary('apikey=super-secret')).toBe('apikey=[redacted]')
  })
})
