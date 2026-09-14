import { NextResponse, type NextRequest } from 'next/server'

/**
 * Per-request Content-Security-Policy with a fresh nonce. This lives in
 * `proxy.ts` (Next.js 16's replacement for `middleware.ts`) because the
 * nonce must be unique per response — it cannot be a static header declared
 * in `next.config.ts`. Next.js automatically applies this same nonce to the
 * inline bootstrap/flight-data scripts it renders for the App Router, so no
 * further wiring is needed for hydration to keep working under this policy.
 *
 * Reading the request's locale cookie elsewhere already opts every page
 * into dynamic rendering, which this nonce approach requires anyway.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isDev = process.env.NODE_ENV === 'development'

  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''};
    style-src 'self' 'nonce-${nonce}';
    img-src 'self' data:;
    font-src 'self';
    connect-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `
  const contentSecurityPolicyHeaderValue = cspHeader.replace(/\s{2,}/g, ' ').trim()

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicyHeaderValue)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', contentSecurityPolicyHeaderValue)
  return response
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
