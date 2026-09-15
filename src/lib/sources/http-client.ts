import type { z } from 'zod'
import { validateAllowlistedHttpsUrl } from '../ingestion/urls'

export type FetchFailureKind = 'transient' | 'deterministic'

/**
 * A single schema-validation failure, safe to surface in a log line or
 * `ingestion_runs.error_summary`: only the failing field's location
 * (`path`), Zod's issue `code`, and — only when Zod exposes it as a plain
 * type-name string (e.g. `"string"`) — the `expected` type. Never the
 * actual received value, the response body, or anything else
 * value-shaped. If a future Zod version doesn't expose a safe string for
 * `expected`, `expected` is simply omitted; `path`/`code` alone are always
 * safe and always present.
 */
export interface SchemaIssueSummary {
  path: string
  code: string
  expected?: string
}

export type FetchJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string; kind: FetchFailureKind; schemaIssues?: SchemaIssueSummary[] }

export interface FetchJsonOptions {
  timeoutMs: number
  maxResponseBytes: number
  /** Redirects to follow (each hop re-validated against `allowedHosts`).
   * Pass `0` to reject any redirect outright — the credential-bearing
   * Jooble adapter does this so a redirect can never forward its API key
   * to another host (docs/SECURITY.md M6A). */
  maxRedirects: number
  allowedHosts: readonly string[]
  fetchImpl: typeof fetch
  /** Defaults to `GET`. */
  method?: 'GET' | 'POST'
  /** Request body for `method: 'POST'`. Never logged, returned, or
   * included in any failure reason string below. */
  body?: string
}

/**
 * Injectable-fetch JSON client enforcing every network-safety requirement
 * from docs/SECURITY.md/docs/ARCHITECTURE.md in one place: HTTPS +
 * allowlist (including on every redirect hop, resolved manually — Node's
 * `fetch` with `redirect: 'manual'` returns the real 3xx response rather
 * than an opaque one, confirmed via undici's own docs), a byte-size limit
 * enforced both via Content-Length and while streaming, a timeout, and a
 * bounded redirect count.
 *
 * One `AbortController`/timeout covers the ENTIRE call — every redirect
 * hop, header wait, body streaming, JSON parsing, and schema validation —
 * not a fresh budget per hop. It is cleared only once, in the outer
 * `finally`, after the last thing that could block on I/O has finished.
 * (Regression: an earlier version cleared it as soon as headers arrived,
 * so a response that stalled mid-body never timed out at all.)
 *
 * Failures are tagged `transient` (worth retrying: network error, timeout,
 * 5xx, 429) or `deterministic` (never retry: bad URL, malformed JSON,
 * schema mismatch, any other 4xx, a disallowed redirect target) — this
 * drives `withRetries` below and, in the adapter, whether a scan can still
 * be considered complete.
 */
export async function fetchAllowlistedJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options: FetchJsonOptions,
): Promise<FetchJsonResult<T>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)

  try {
    let currentUrl = url
    for (let hop = 0; hop <= options.maxRedirects; hop++) {
      const validated = validateAllowlistedHttpsUrl(currentUrl, options.allowedHosts)
      if (!validated.ok) return { ok: false, reason: validated.reason, kind: 'deterministic' }

      let response: Response
      try {
        response = await options.fetchImpl(validated.url, {
          method: options.method ?? 'GET',
          body: options.body,
          redirect: 'manual',
          signal: controller.signal,
          headers:
            options.method === 'POST'
              ? { accept: 'application/json', 'content-type': 'application/json' }
              : { accept: 'application/json' },
        })
      } catch (error) {
        const isAbort = error instanceof Error && error.name === 'AbortError'
        return { ok: false, reason: isAbort ? 'timeout' : 'network error', kind: 'transient' }
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) return { ok: false, reason: 'redirect without location', kind: 'deterministic' }
        currentUrl = new URL(location, validated.url).toString()
        continue
      }

      if (response.status === 429 || response.status >= 500) {
        return { ok: false, reason: `unexpected status ${response.status}`, kind: 'transient' }
      }
      if (!response.ok) {
        return { ok: false, reason: `unexpected status ${response.status}`, kind: 'deterministic' }
      }

      const contentLength = response.headers.get('content-length')
      if (contentLength && Number(contentLength) > options.maxResponseBytes) {
        return { ok: false, reason: 'response too large', kind: 'deterministic' }
      }

      let text: string | null
      try {
        text = await readBoundedText(response, options.maxResponseBytes, controller.signal)
      } catch (error) {
        const isAbort = error instanceof Error && error.name === 'AbortError'
        return { ok: false, reason: isAbort ? 'timeout' : 'network error', kind: 'transient' }
      }
      if (text === null) return { ok: false, reason: 'response too large', kind: 'deterministic' }

      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        return { ok: false, reason: 'invalid JSON', kind: 'deterministic' }
      }

      const parsed = schema.safeParse(json)
      if (!parsed.success) {
        return {
          ok: false,
          reason: 'schema validation failed',
          kind: 'deterministic',
          schemaIssues: summarizeSchemaIssuesSafely(parsed.error),
        }
      }
      return { ok: true, data: parsed.data }
    }
    return { ok: false, reason: 'too many redirects', kind: 'deterministic' }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Reads a response body up to `maxBytes`, racing every chunk read against
 * `signal` so a deadline that fires mid-stream aborts the read (throwing an
 * `AbortError`-named error) instead of waiting on a `reader.read()` that
 * may never resolve. Returns `null` (not a throw) when the byte cap is
 * exceeded — that's a deterministic rejection, not a timeout.
 */
async function readBoundedText(response: Response, maxBytes: number, signal: AbortSignal): Promise<string | null> {
  const reader = response.body?.getReader()
  if (!reader) return await response.text()

  if (signal.aborted) {
    await reader.cancel().catch(() => {})
    throw makeAbortError()
  }

  let onAbort: (() => void) | undefined
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => reject(makeAbortError())
    signal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), abortPromise])
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel().catch(() => {})
          return null
        }
        chunks.push(value)
      }
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf-8')
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

const MAX_SCHEMA_ISSUES = 5
const MAX_SCHEMA_ISSUE_FIELD_LENGTH = 200

/**
 * Extracts a small, bounded, value-free summary of a `ZodError` — see
 * `SchemaIssueSummary`'s doc comment for exactly what is and isn't safe to
 * include. Deliberately never reads `.message` (its exact wording is
 * version-dependent and, for a custom `.refine()`, developer-controlled —
 * neither is a guarantee against ever echoing input) — only the
 * structured `path`/`code`/`expected` fields, and only when `expected` is
 * confirmed to be a plain string.
 */
function summarizeSchemaIssuesSafely(error: z.ZodError): SchemaIssueSummary[] {
  return error.issues.slice(0, MAX_SCHEMA_ISSUES).map((issue) => {
    const path = (issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)').slice(
      0,
      MAX_SCHEMA_ISSUE_FIELD_LENGTH,
    )
    const summary: SchemaIssueSummary = { path, code: issue.code }
    const expected = (issue as { expected?: unknown }).expected
    if (typeof expected === 'string') summary.expected = expected.slice(0, MAX_SCHEMA_ISSUE_FIELD_LENGTH)
    return summary
  })
}

function makeAbortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

export interface RetryOptions {
  maxRetries: number
  baseDelayMs: number
  sleep?: (ms: number) => Promise<void>
}

export async function withRetries<T>(
  fn: () => Promise<FetchJsonResult<T>>,
  options: RetryOptions,
): Promise<FetchJsonResult<T>> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let last: FetchJsonResult<T> | undefined
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    const result = await fn()
    if (result.ok || result.kind !== 'transient' || attempt === options.maxRetries) return result
    last = result
    const jitter = Math.random() * options.baseDelayMs
    await sleep(options.baseDelayMs * 2 ** attempt + jitter)
  }
  return last!
}
