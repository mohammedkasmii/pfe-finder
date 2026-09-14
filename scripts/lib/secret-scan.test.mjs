import { describe, expect, it } from 'vitest'
import { isForbiddenFile, scanContent } from './secret-scan.mjs'

describe('scanContent', () => {
  it('flags an AWS access key ID', () => {
    const findings = scanContent('const key = "AKIAABCDEFGHIJKLMNOP"', 'src/example.ts')
    expect(findings).toHaveLength(1)
    expect(findings[0].file).toBe('src/example.ts')
  })

  it('flags a generic assigned secret naming a service role', () => {
    const findings = scanContent(
      'SUPABASE_SERVICE_ROLE_KEY="abcdefghijklmnopqrstuvwxyz"',
      '.env.local.bak',
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it('flags a PEM private key block', () => {
    const findings = scanContent('-----BEGIN RSA PRIVATE KEY-----\nMIIB...\n', 'key.pem')
    expect(findings.length).toBeGreaterThan(0)
  })

  it('flags a JWT-shaped literal', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const findings = scanContent(`const token = "${jwt}"`, 'notes.md')
    expect(findings.length).toBeGreaterThan(0)
  })

  it('returns no findings for ordinary source text', () => {
    const findings = scanContent(
      "export function add(a: number, b: number) {\n  return a + b\n}\n",
      'src/add.ts',
    )
    expect(findings).toEqual([])
  })

  it('does not flag the documented .env.example placeholders', () => {
    const findings = scanContent(
      'NEXT_PUBLIC_SUPABASE_URL=\nNEXT_PUBLIC_SUPABASE_ANON_KEY=\n',
      '.env.example',
    )
    expect(findings).toEqual([])
  })
})

describe('isForbiddenFile', () => {
  it('flags .env and .env.local by basename regardless of directory', () => {
    expect(isForbiddenFile('.env')).toBe(true)
    expect(isForbiddenFile('.env.local')).toBe(true)
    expect(isForbiddenFile('apps/web/.env.local')).toBe(true)
  })

  it('does not flag .env.example', () => {
    expect(isForbiddenFile('.env.example')).toBe(false)
  })

  it('does not flag unrelated files', () => {
    expect(isForbiddenFile('src/lib/env.ts')).toBe(false)
  })
})
