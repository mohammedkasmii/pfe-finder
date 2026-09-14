import type { z } from 'zod'
import { validateAllowlistedHttpsUrl } from '../ingestion/urls'

export type FetchFailureKind = 'transient' | 'deterministic'
export type FetchJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string; kind: FetchFailureKind }

export interface FetchJsonOptions {
  timeoutMs: number
  maxResponseBytes: number
  maxRedirects: number
  allowedHosts: readonly string[]
  fetchImpl: typeof fetch
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
          redirect: 'manual',
          signal: controller.signal,
          headers: { accept: 'application/json' },
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
      if (!parsed.success) return { ok: false, reason: 'schema validation failed', kind: 'deterministic' }
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
