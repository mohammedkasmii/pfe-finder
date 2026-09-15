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

// Supabase's own config.toml indirection syntax — e.g.
// `openai_api_key = "env(OPENAI_API_KEY)"` — names an environment
// variable to read at runtime; it is never itself a secret value. Exempts
// ONLY a quoted value that is EXACTLY this shape (anchored start/end): a
// literal `env(...)` wrapper around an uppercase env-var-style name.
// Anything else quoted — including malformed or trailing-content
// variations of this syntax — is still treated as a real assigned secret.
const ENV_REFERENCE_ONLY = /^env\([A-Z_][A-Z0-9_]*\)$/

const SECRET_PATTERNS = [
  { name: 'AWS access key ID', pattern: /AKIA[0-9A-Z]{16}/ },
  {
    name: 'generic assigned secret (service role, API key, password, ...)',
    // Matches an identifier that CONTAINS a sensitive word anywhere
    // (e.g. `SUPABASE_SERVICE_ROLE_KEY`, not just an exact `service_role`
    // token) assigned a quoted, non-trivial value. The quoted value is
    // captured (group 1) so it can be checked against ENV_REFERENCE_ONLY
    // before being treated as a finding.
    pattern:
      /[A-Z0-9_]*(?:SECRET|SERVICE[_-]?ROLE|API[_-]?KEY|PRIVATE[_-]?KEY|PASSWORD)[A-Z0-9_]*\s*[:=]\s*['"]([^'"\s]{8,})['"]/gi,
    isEnvReferenceExempt: true,
  },
  { name: 'PEM private key block', pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'JWT-shaped literal', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
]

const FORBIDDEN_BASENAMES = new Set(['.env', '.env.local'])

/**
 * True if at least one match of `pattern` (a global-flagged RegExp) in
 * `content` is a real assigned value rather than an exempt env-var
 * indirection reference. Resets `pattern.lastIndex` first, since these
 * RegExp objects are module-level constants reused across every file this
 * scanner checks — a stateful `lastIndex` left over from an early return
 * on a previous file would silently skip content in the next one.
 */
function hasNonExemptMatch(pattern, content) {
  pattern.lastIndex = 0
  let match
  while ((match = pattern.exec(content)) !== null) {
    if (!ENV_REFERENCE_ONLY.test(match[1])) {
      pattern.lastIndex = 0
      return true
    }
    if (match[0].length === 0) pattern.lastIndex++
  }
  return false
}

/** @returns {Array<{ file: string, rule: string }>} */
export function scanContent(content, filePath) {
  const findings = []
  for (const { name, pattern, isEnvReferenceExempt } of SECRET_PATTERNS) {
    if (isEnvReferenceExempt) {
      if (hasNonExemptMatch(pattern, content)) findings.push({ file: filePath, rule: name })
      continue
    }
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
