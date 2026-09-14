/**
 * Pure, dependency-free secret detection. Kept separate from the CLI
 * wrapper (`scripts/scan-secrets.mjs`) so the rules are unit-testable
 * without touching the filesystem or git.
 *
 * Any of these patterns matching in a *tracked* repository file is treated
 * as a finding regardless of which specific credential it looks like (a
 * Supabase anon key is meant to be public, but it belongs in Vercel's
 * environment configuration or a gitignored `.env.local`, never committed
 * source — so the JWT pattern below is intentionally not scoped to only
 * the service-role key).
 */
const SECRET_PATTERNS = [
  { name: 'AWS access key ID', pattern: /AKIA[0-9A-Z]{16}/ },
  {
    name: 'generic assigned secret (service role, API key, password, ...)',
    // Matches an identifier that CONTAINS a sensitive word anywhere
    // (e.g. `SUPABASE_SERVICE_ROLE_KEY`, not just an exact `service_role`
    // token) assigned a quoted, non-trivial value.
    pattern:
      /[A-Z0-9_]*(SECRET|SERVICE[_-]?ROLE|API[_-]?KEY|PRIVATE[_-]?KEY|PASSWORD)[A-Z0-9_]*\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
  },
  { name: 'PEM private key block', pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'JWT-shaped literal', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
]

const FORBIDDEN_BASENAMES = new Set(['.env', '.env.local'])

/** @returns {Array<{ file: string, rule: string }>} */
export function scanContent(content, filePath) {
  const findings = []
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({ file: filePath, rule: name })
    }
  }
  return findings
}

export function isForbiddenFile(filePath) {
  const basename = filePath.split(/[\\/]/).pop() ?? ''
  return FORBIDDEN_BASENAMES.has(basename)
}
