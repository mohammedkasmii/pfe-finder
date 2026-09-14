import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { proxy } from './proxy'

function makeRequest() {
  return new NextRequest('http://localhost:3000/')
}

describe('proxy (CSP nonce)', () => {
  it('sets a Content-Security-Policy header with a nonce and safe defaults', () => {
    const response = proxy(makeRequest())
    const csp = response.headers.get('Content-Security-Policy')
    expect(csp).toBeTruthy()
    expect(csp).toMatch(/nonce-[A-Za-z0-9+/=]+/)
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'self'")
  })

  it('forwards the nonce as a request header so server components can read it', () => {
    const response = proxy(makeRequest())
    const forwardedNonce = response.headers.get('x-middleware-request-x-nonce')
    const csp = response.headers.get('Content-Security-Policy')
    expect(forwardedNonce).toBeTruthy()
    expect(csp).toContain(`nonce-${forwardedNonce}`)
  })

  it('generates a different nonce on every call', () => {
    const first = proxy(makeRequest()).headers.get('Content-Security-Policy')
    const second = proxy(makeRequest()).headers.get('Content-Security-Policy')
    expect(first).not.toBe(second)
  })
})
