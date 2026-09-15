import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const limitMock = vi.fn()
const ratelimitConstructorMock = vi.fn()

vi.mock('@upstash/redis', () => ({
  Redis: class {},
}))

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    constructor(...args: unknown[]) {
      ratelimitConstructorMock(...args)
      return { limit: limitMock } as unknown as Ratelimit
    }
    static slidingWindow = vi.fn().mockReturnValue('sliding-window-config')
  },
}))

type Ratelimit = { limit: typeof limitMock }

describe('checkRateLimit', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    limitMock.mockReset()
    ratelimitConstructorMock.mockReset()
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('allows the request and never constructs a limiter when not configured', async () => {
    const { checkRateLimit } = await import('./limiter')
    const result = await checkRateLimit('1.2.3.4')
    expect(result).toEqual({ allowed: true })
    expect(ratelimitConstructorMock).not.toHaveBeenCalled()
  })

  it('allows the request when limit() resolves success: true', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://x.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
    limitMock.mockResolvedValue({ success: true })
    const { checkRateLimit } = await import('./limiter')
    expect(await checkRateLimit('1.2.3.4')).toEqual({ allowed: true })
  })

  it('denies the request when limit() resolves success: false', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://x.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
    limitMock.mockResolvedValue({ success: false })
    const { checkRateLimit } = await import('./limiter')
    expect(await checkRateLimit('1.2.3.4')).toEqual({ allowed: false })
  })

  it('fails open (allows the request) when limit() rejects, without throwing', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://x.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
    limitMock.mockRejectedValue(new Error('redis unreachable'))
    const { checkRateLimit } = await import('./limiter')
    await expect(checkRateLimit('1.2.3.4')).resolves.toEqual({ allowed: true })
  })

  it('constructs the limiter only once across repeated calls (cached)', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://x.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
    limitMock.mockResolvedValue({ success: true })
    const { checkRateLimit } = await import('./limiter')
    await checkRateLimit('1.2.3.4')
    await checkRateLimit('5.6.7.8')
    expect(ratelimitConstructorMock).toHaveBeenCalledTimes(1)
  })
})
