import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { fetchAllowlistedJson, withRetries, type FetchJsonResult } from './http-client'

const ALLOWED_HOSTS = ['api.smartrecruiters.com']
const Schema = z.object({ ok: z.boolean() })

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function baseOptions(fetchImpl: typeof fetch) {
  return {
    timeoutMs: 1000,
    maxResponseBytes: 1000,
    maxRedirects: 3,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl,
  }
}

describe('fetchAllowlistedJson', () => {
  it('returns ok:true for a valid response matching the schema', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
    expect(result).toEqual({ ok: true, data: { ok: true } })
  })

  it('rejects a disallowed host deterministically without calling fetch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    const result = await fetchAllowlistedJson('https://evil.example.com/x', Schema, baseOptions(fetchImpl))
    expect(result).toMatchObject({ ok: false, kind: 'deterministic' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('follows one allowlisted redirect and revalidates the target', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://api.smartrecruiters.com/y' } }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
    expect(result).toEqual({ ok: true, data: { ok: true } })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('rejects a redirect pointing outside the allowlist instead of following it', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'https://evil.example.com/y' } }),
    )
    const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
    expect(result).toMatchObject({ ok: false, kind: 'deterministic' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('gives up after too many redirects', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'https://api.smartrecruiters.com/loop' } }),
    )
    const result = (await fetchAllowlistedJson(
      'https://api.smartrecruiters.com/x',
      Schema,
      baseOptions(fetchImpl),
    )) as FetchJsonResult<unknown>
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('too many redirects')
  })

  it('rejects a response whose Content-Length exceeds the byte limit without reading the body', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true }, { headers: { 'content-type': 'application/json', 'content-length': '999999' } }),
    )
    const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
    expect(result).toMatchObject({ ok: false, kind: 'deterministic', reason: 'response too large' })
  })

  it('rejects a body that streams past the byte limit even without a Content-Length header', async () => {
    const bigBody = JSON.stringify({ ok: true, filler: 'x'.repeat(5000) })
    const fetchImpl = vi.fn(async () => new Response(bigBody, { status: 200 }))
    const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
    expect(result).toMatchObject({ ok: false, kind: 'deterministic', reason: 'response too large' })
  })

  it('times out a response whose headers arrive but whose body never finishes (regression: timer cleared before body read)', async () => {
    const fetchImpl = vi.fn(async () => {
      const stalledStream = new ReadableStream<Uint8Array>({
        start() {
          // Deliberately never enqueue or close: the body never finishes.
        },
      })
      return new Response(stalledStream, { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const start = Date.now()
    const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, {
      ...baseOptions(fetchImpl),
      timeoutMs: 30,
    })
    const elapsedMs = Date.now() - start

    expect(result).toMatchObject({ ok: false, kind: 'transient', reason: 'timeout' })
    // Must resolve close to the configured deadline, not hang indefinitely.
    expect(elapsedMs).toBeLessThan(2000)
  })

  it('treats malformed JSON as deterministic', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 }))
    const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
    expect(result).toMatchObject({ ok: false, kind: 'deterministic', reason: 'invalid JSON' })
  })

  it('treats a schema mismatch as deterministic', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ notTheRightShape: 1 }))
    const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
    expect(result).toMatchObject({ ok: false, kind: 'deterministic', reason: 'schema validation failed' })
  })

  describe('schema-failure diagnostics (safe: path/code/expected only, never a received value)', () => {
    it('includes a bounded, value-free schemaIssues summary on a schema mismatch', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ ok: 'not-a-boolean-secret-value-12345' }))
      const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.schemaIssues).toBeDefined()
      expect(result.schemaIssues!.length).toBeGreaterThan(0)
      const issue = result.schemaIssues![0]!
      expect(issue.path).toBe('ok')
      expect(typeof issue.code).toBe('string')
      if (issue.expected !== undefined) expect(issue.expected).toBe('boolean')
    })

    it('never includes the actual received value anywhere in schemaIssues', async () => {
      const sensitiveValue = 'sk-sample-secret-value-should-never-appear'
      const fetchImpl = vi.fn(async () => jsonResponse({ ok: sensitiveValue }))
      const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
      expect(result.ok).toBe(false)
      if (result.ok) return
      const serialized = JSON.stringify(result.schemaIssues)
      expect(serialized).not.toContain(sensitiveValue)
    })

    it('reports "(root)" as the path for a top-level shape mismatch', async () => {
      const fetchImpl = vi.fn(async () => new Response('null', { status: 200 }))
      const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.schemaIssues?.[0]?.path).toBe('(root)')
    })

    it('bounds the number of reported issues even when many fields fail at once', async () => {
      const ManySchema = z.object({
        a: z.boolean(),
        b: z.boolean(),
        c: z.boolean(),
        d: z.boolean(),
        e: z.boolean(),
        f: z.boolean(),
        g: z.boolean(),
      })
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1 }),
      )
      const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', ManySchema, baseOptions(fetchImpl))
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.schemaIssues!.length).toBeLessThanOrEqual(5)
    })

    it('never returns schemaIssues on success', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
      const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
      expect(result).not.toHaveProperty('schemaIssues')
    })
  })

  it('treats a 500 as transient', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }))
    const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
    expect(result).toMatchObject({ ok: false, kind: 'transient' })
  })

  it('treats a 429 as transient', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 429 }))
    const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
    expect(result).toMatchObject({ ok: false, kind: 'transient' })
  })

  it('treats a 404 as deterministic', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }))
    const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
    expect(result).toMatchObject({ ok: false, kind: 'deterministic' })
  })

  it('treats an aborted/timed-out fetch as transient with reason timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    })
    const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
    expect(result).toMatchObject({ ok: false, kind: 'transient', reason: 'timeout' })
  })

  it('treats a generic network error as transient', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    const result = await fetchAllowlistedJson('https://api.smartrecruiters.com/x', Schema, baseOptions(fetchImpl))
    expect(result).toMatchObject({ ok: false, kind: 'transient', reason: 'network error' })
  })
})

describe('withRetries', () => {
  const noopSleep = async () => {}

  it('retries a transient failure up to maxRetries then returns the last failure', async () => {
    const fn = vi.fn<() => Promise<FetchJsonResult<unknown>>>(async () => ({
      ok: false,
      reason: 'network error',
      kind: 'transient',
    }))
    const result = await withRetries(fn, { maxRetries: 2, baseDelayMs: 1, sleep: noopSleep })
    expect(fn).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ ok: false, kind: 'transient' })
  })

  it('never retries a deterministic failure', async () => {
    const fn = vi.fn<() => Promise<FetchJsonResult<unknown>>>(async () => ({
      ok: false,
      reason: 'schema validation failed',
      kind: 'deterministic',
    }))
    const result = await withRetries(fn, { maxRetries: 2, baseDelayMs: 1, sleep: noopSleep })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, kind: 'deterministic' })
  })

  it('returns a successful result on the 2nd attempt without further retries', async () => {
    const fn = vi
      .fn<() => Promise<FetchJsonResult<{ ok: boolean }>>>()
      .mockResolvedValueOnce({ ok: false, reason: 'timeout', kind: 'transient' })
      .mockResolvedValueOnce({ ok: true, data: { ok: true } })
    const result = await withRetries(fn, { maxRetries: 2, baseDelayMs: 1, sleep: noopSleep })
    expect(fn).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ ok: true, data: { ok: true } })
  })
})
