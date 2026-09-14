import type { NextConfig } from 'next'
import { getStaticSecurityHeaders } from './src/lib/security-headers'

const nextConfig: NextConfig = {
  // The on-screen dev indicator injects inline styles without our CSP
  // nonce, which our strict style-src then (correctly) blocks. It carries
  // no application behavior, so it's turned off rather than the policy
  // weakened.
  devIndicators: false,
  // Don't advertise the framework in responses.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: getStaticSecurityHeaders({ isProduction: process.env.NODE_ENV === 'production' }),
      },
    ]
  },
}

export default nextConfig
