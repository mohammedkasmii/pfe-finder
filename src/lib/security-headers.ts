export interface SecurityHeader {
  key: string
  value: string
}

export interface SecurityHeadersOptions {
  isProduction: boolean
}

/**
 * Headers that do not depend on a per-request nonce and can therefore be
 * declared statically in `next.config.ts`. The Content-Security-Policy
 * header is generated per-request instead, in `src/proxy.ts`, because it
 * carries a fresh nonce on every response.
 */
export function getStaticSecurityHeaders({ isProduction }: SecurityHeadersOptions): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    },
  ]

  if (isProduction) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    })
  }

  return headers
}
