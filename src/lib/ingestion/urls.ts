import { createHash } from 'node:crypto'

export type UrlValidationResult = { ok: true; url: string } | { ok: false; reason: string }

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])
const TRACKING_PARAM_NAMES = new Set(['gclid', 'fbclid', 'mc_cid', 'mc_eid', 'igshid', 'ref', 'yclid', 'msclkid'])

function isPrivateIpv4Literal(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false
  const a = Number(match[1])
  const b = Number(match[2])
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/**
 * The SSRF/allowlist gate for every source/apply URL and every fetch the
 * ingestion adapters make (docs/SECURITY.md: "source-level HTTPS host
 * allowlist... resolve redirects manually and reject every destination
 * outside the allowlist"). Exact hostname match only — never a suffix or
 * substring match, which a lookalike domain could otherwise pass.
 */
export function validateAllowlistedHttpsUrl(rawUrl: string, allowedHosts: readonly string[]): UrlValidationResult {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'malformed URL' }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'must use https' }
  if (url.username || url.password) return { ok: false, reason: 'must not carry credentials' }
  if (LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())) return { ok: false, reason: 'must not target localhost' }
  if (isPrivateIpv4Literal(url.hostname)) return { ok: false, reason: 'must not target a private IP address' }
  if (!allowedHosts.includes(url.hostname)) return { ok: false, reason: `host not allowlisted: ${url.hostname}` }
  return { ok: true, url: url.toString() }
}

export function stripTrackingParams(rawUrl: string): string {
  const url = new URL(rawUrl)
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAM_NAMES.has(key.toLowerCase())) {
      url.searchParams.delete(key)
    }
  }
  return url.toString()
}

export function computeCanonicalUrlHash(rawUrl: string): string {
  return createHash('sha256').update(stripTrackingParams(rawUrl)).digest('hex')
}
