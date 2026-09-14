import { describe, expect, it } from 'vitest'
import { getStaticSecurityHeaders } from './security-headers'

function findHeader(headers: Array<{ key: string; value: string }>, key: string) {
  return headers.find((header) => header.key === key)
}

describe('getStaticSecurityHeaders', () => {
  it('always includes the baseline hardening headers', () => {
    const headers = getStaticSecurityHeaders({ isProduction: false })
    expect(findHeader(headers, 'X-Content-Type-Options')?.value).toBe('nosniff')
    expect(findHeader(headers, 'Referrer-Policy')?.value).toBe('strict-origin-when-cross-origin')
    expect(findHeader(headers, 'X-Frame-Options')?.value).toBe('DENY')
    expect(findHeader(headers, 'Permissions-Policy')).toBeDefined()
  })

  it('omits Strict-Transport-Security outside production', () => {
    const headers = getStaticSecurityHeaders({ isProduction: false })
    expect(findHeader(headers, 'Strict-Transport-Security')).toBeUndefined()
  })

  it('adds Strict-Transport-Security in production', () => {
    const headers = getStaticSecurityHeaders({ isProduction: true })
    const hsts = findHeader(headers, 'Strict-Transport-Security')
    expect(hsts?.value).toContain('max-age=')
    expect(hsts?.value).toContain('includeSubDomains')
  })

  it('never emits a duplicate header key', () => {
    const headers = getStaticSecurityHeaders({ isProduction: true })
    const keys = headers.map((header) => header.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
