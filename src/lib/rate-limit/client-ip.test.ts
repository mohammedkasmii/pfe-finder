import { describe, expect, it } from 'vitest'
import { getClientIp } from './client-ip'

function request(headers: Record<string, string>): Request {
  return new Request('https://example.com/api/offers', { headers })
}

describe('getClientIp', () => {
  it('reads a single IP from x-forwarded-for', () => {
    expect(getClientIp(request({ 'x-forwarded-for': '203.0.113.5' }).headers)).toBe('203.0.113.5')
  })

  it('takes the first IP of a comma-separated x-forwarded-for list', () => {
    expect(
      getClientIp(request({ 'x-forwarded-for': '203.0.113.5, 70.41.3.18, 150.172.238.178' }).headers),
    ).toBe('203.0.113.5')
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    expect(getClientIp(request({ 'x-real-ip': '198.51.100.7' }).headers)).toBe('198.51.100.7')
  })

  it('falls back to "unknown" when neither header is present', () => {
    expect(getClientIp(request({}).headers)).toBe('unknown')
  })

  it('works with a plain object implementing get(), matching next/headers()\'s ReadonlyHeaders shape', () => {
    const readonlyHeadersLike = { get: (name: string) => (name === 'x-forwarded-for' ? '203.0.113.9' : null) }
    expect(getClientIp(readonlyHeadersLike)).toBe('203.0.113.9')
  })
})
