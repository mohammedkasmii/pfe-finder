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
