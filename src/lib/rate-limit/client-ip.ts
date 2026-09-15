/** The subset of the Fetch `Headers` interface both a Route Handler's
 * `Request.headers` and `next/headers`'s `headers()` result implement —
 * letting one function serve both call sites (the API route and the
 * `/offers` server page's own rate-limit check). */
export interface HeadersLike {
  get(name: string): string | null
}

/**
 * Next.js 16 Route Handlers expose no `request.ip`/`request.geo` — the
 * app-route request proxy explicitly returns `undefined` for both
 * (confirmed against the Next.js source). `x-forwarded-for` is what
 * Vercel (and any standard reverse proxy) actually sets.
 */
export function getClientIp(headers: HeadersLike): string {
  const forwardedFor = headers.get('x-forwarded-for')
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return 'unknown'
}
