import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { loadRateLimitConfig } from './config'

// undefined = not yet initialized this process; null = confirmed disabled
// (no config). Distinguishing the two avoids re-checking env vars (and
// re-constructing a Redis client) on every single request.
let limiter: Ratelimit | null | undefined

function getLimiter(): Ratelimit | null {
  if (limiter !== undefined) return limiter
  const config = loadRateLimitConfig()
  if (!config) {
    limiter = null
    return null
  }
  limiter = new Ratelimit({
    redis: new Redis({ url: config.url, token: config.token }),
    limiter: Ratelimit.slidingWindow(30, '60 s'),
    // Upstash's own fail-open: a slow Redis call resolves as allowed
    // rather than holding up the response indefinitely.
    timeout: 1000,
    analytics: false,
    prefix: 'pfe-offers',
  })
  return limiter
}

export interface RateLimitCheckResult {
  allowed: boolean
}

/**
 * docs/SECURITY.md: "Apply IP-based rate limiting to /api/offers; fail
 * safely when the limiter is unavailable and never expose database
 * errors." Not configured (no Upstash env vars — the default in this
 * sandbox, local dev, and CI) or any runtime error talking to Redis both
 * resolve as `{ allowed: true }`: a rate limiter is an abuse/cost control,
 * not the app's actual security boundary (that's RLS + parameterized
 * queries + bounded params), so a limiter outage must never take down a
 * read-only public API.
 */
export async function checkRateLimit(identifier: string): Promise<RateLimitCheckResult> {
  const instance = getLimiter()
  if (!instance) return { allowed: true }
  try {
    const { success } = await instance.limit(identifier)
    return { allowed: success }
  } catch {
    return { allowed: true }
  }
}

/** Test-only: forces the next call to re-read config and rebuild the limiter. */
export function __resetRateLimiterForTests(): void {
  limiter = undefined
}
