const MAX_ERROR_SUMMARY_LENGTH = 500

// Defense in depth: our own code never puts a credential or full response
// body into an error summary (every caller passes a small, hand-written
// reason string or a caught Error's `.message`, never a stack trace or raw
// response body), but redact anything credential-shaped anyway.
const CREDENTIAL_LIKE_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|bearer\s+\S+/gi

// URL userinfo (`scheme://user:pass@host`) — covers both credential-bearing
// HTTP(S) URLs and connection strings (postgres://, postgresql://, etc.),
// since the userinfo syntax is identical across schemes.
const URL_USERINFO_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi

// A URL's query string can carry tokens/keys even under an innocuous-looking
// parameter name, so the whole query string is redacted rather than trying
// to name every sensitive key. Any scheme, not just http(s) — a real
// adversarial case: `postgres://db.example/pfe?password=super-secret` was
// left completely unredacted by an http(s)-only pattern.
const URL_QUERY_STRING_PATTERN = /([a-z][a-z0-9+.-]*:\/\/[^\s?]+)\?[^\s]*/gi

// A credential assignment outside of any URL — e.g. embedded in a plain
// key=value diagnostic line rather than a query string. Matches
// `password=`, `token=`, `api_key=`, and `apikey=` (case-insensitive) up
// to the next whitespace or `&`.
const STANDALONE_CREDENTIAL_ASSIGNMENT_PATTERN = /\b(password|token|api_key|apikey)=[^\s&]+/gi

/**
 * Bounds and redacts a message before it can ever reach
 * ingestion_runs.error_summary or a collector log line (docs/SECURITY.md:
 * "Keep error summaries bounded and sanitized. Never log credentials...
 * connection strings, or stack traces."). Collapses all line-breaking
 * whitespace first so multiline stack-like content can never occupy more
 * than one log line, then redacts URL credentials/query strings, then
 * standalone credential-shaped assignments, then JWT/bearer-shaped
 * substrings, then truncates.
 */
export function boundedErrorSummary(message: string): string {
  const singleLine = message.replace(/[\r\n\t]+/g, ' ')
  const withoutUrlCredentials = singleLine.replace(URL_USERINFO_PATTERN, '$1[redacted]@')
  const withoutQueryStrings = withoutUrlCredentials.replace(URL_QUERY_STRING_PATTERN, '$1?[redacted]')
  const withoutStandaloneCredentials = withoutQueryStrings.replace(
    STANDALONE_CREDENTIAL_ASSIGNMENT_PATTERN,
    '$1=[redacted]',
  )
  return withoutStandaloneCredentials.replace(CREDENTIAL_LIKE_PATTERN, '[redacted]').slice(0, MAX_ERROR_SUMMARY_LENGTH)
}
