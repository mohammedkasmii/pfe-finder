export type UpstashConfigParseResult =
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'valid'; url: string; token: string }

/**
 * The ONE strict parser for the Upstash Redis REST URL/token pair,
 * shared by `src/lib/env.ts` (boot-time validation — mandatory and
 * strictly validated in production) and `loadRateLimitConfig` below (the
 * runtime accessor `limiter.ts` actually calls). A single shared parser
 * is what prevents the two from drifting apart — the exact bug the M3
 * review found: environment validation used a naive `.startsWith('https://')`
 * check while nothing validated the token at all, so `https://` (no
 * host), a credential-bearing URL, and a whitespace-only token were all
 * silently accepted as valid production configuration.
 *
 * - `'absent'`: both raw values are empty/unset — "not configured",
 *   which is fine outside production (see env.ts).
 * - `'invalid'`: anything else wrong — only one of the pair present, an
 *   unparseable URL, non-HTTPS, a non-`upstash.io` host, URL-embedded
 *   credentials, or a blank/whitespace-only token.
 * - `'valid'`: a genuine, usable pair (both trimmed).
 */
export function parseUpstashConfig(rawUrl: string | undefined, rawToken: string | undefined): UpstashConfigParseResult {
  const url = (rawUrl ?? '').trim()
  const token = (rawToken ?? '').trim()

  if (!url && !token) return { kind: 'absent' }
  if (!url || !token) {
    return { kind: 'invalid', reason: 'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must both be set or both omitted' }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { kind: 'invalid', reason: 'UPSTASH_REDIS_REST_URL must be a valid URL' }
  }

  if (parsed.protocol !== 'https:') {
    return { kind: 'invalid', reason: 'UPSTASH_REDIS_REST_URL must be an HTTPS URL' }
  }
  if (parsed.username || parsed.password) {
    return { kind: 'invalid', reason: 'UPSTASH_REDIS_REST_URL must not contain URL credentials' }
  }
  if (parsed.hostname !== 'upstash.io' && !parsed.hostname.endsWith('.upstash.io')) {
    return { kind: 'invalid', reason: 'UPSTASH_REDIS_REST_URL must be an upstash.io host' }
  }

  return { kind: 'valid', url: parsed.toString(), token }
}

export interface RateLimitConfig {
  url: string
  token: string
}

/**
 * Rate limiting is opt-in ONLY outside production: absent config means
 * "disabled", never a startup failure there. In production,
 * `src/lib/env.ts` already refuses to boot without a valid pair, so this
 * function returning `null` here should be unreachable in practice —
 * but it still fails safe (disabled, not a crash) rather than trusting
 * that invariant blindly.
 */
export function loadRateLimitConfig(source: Record<string, string | undefined> = process.env): RateLimitConfig | null {
  const result = parseUpstashConfig(source.UPSTASH_REDIS_REST_URL, source.UPSTASH_REDIS_REST_TOKEN)
  return result.kind === 'valid' ? { url: result.url, token: result.token } : null
}
