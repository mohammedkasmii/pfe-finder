import { describe, expect, it, vi } from 'vitest'
import { SOURCE_REGISTRY, type JoobleSourceConfig } from '../registry'
import { createJoobleAdapter, JOOBLE_FIXED_SEARCHES } from './adapter'

const jooble = SOURCE_REGISTRY.find((s) => s.key === 'jooble-morocco')! as JoobleSourceConfig
const SAMPLE_KEY = 'test-jooble-key-0123456789abcdef'

function searchResponse(jobs: { id: string; title: string; link?: string }[], totalCount?: number) {
  return new Response(
    JSON.stringify({
      totalCount: totalCount ?? jobs.length,
      jobs: jobs.map((j) => ({
        id: j.id,
        title: j.title,
        link: j.link ?? `https://ma.jooble.org/desc/${j.id}`,
        snippet: '<p>Stage de développement web avec React.</p>',
        type: 'Internship',
      })),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('createJoobleAdapter', () => {
  it('collects candidates from both fixed searches and reports a complete scan', async () => {
    const fetchImpl = vi.fn(async () => searchResponse([{ id: '1', title: 'Stage informatique' }]))
    const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: SAMPLE_KEY })
    const result = await adapter.collect()

    expect(result.scanComplete).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('sends exactly the two documented fixed request bodies (page=1, ResultOnPage=50, companysearch=false), never user-provided values', async () => {
    const bodies: unknown[] = []
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string))
      return searchResponse([])
    })
    const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: SAMPLE_KEY })
    await adapter.collect()

    expect(bodies).toEqual([
      { keywords: 'stage informatique', location: 'Maroc', page: 1, ResultOnPage: 50, companysearch: false },
      { keywords: 'PFE informatique', location: 'Maroc', page: 1, ResultOnPage: 50, companysearch: false },
    ])
    expect(JOOBLE_FIXED_SEARCHES).toEqual([
      { keywords: 'stage informatique', location: 'Maroc' },
      { keywords: 'PFE informatique', location: 'Maroc' },
    ])
  })

  it('POSTs to https://ma.jooble.org/api/<key> for every request', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url)
      expect(init?.method).toBe('POST')
      return searchResponse([])
    })
    const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: SAMPLE_KEY })
    await adapter.collect()

    expect(urls).toEqual([
      `https://ma.jooble.org/api/${SAMPLE_KEY}`,
      `https://ma.jooble.org/api/${SAMPLE_KEY}`,
    ])
  })

  it('deduplicates a job ID returned by both fixed searches before normalization', async () => {
    const fetchImpl = vi.fn(async () => searchResponse([{ id: 'shared-1', title: 'Stage informatique' }]))
    const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: SAMPLE_KEY })
    const result = await adapter.collect()

    expect(result.fetchedCount).toBe(1)
    expect(result.candidates).toHaveLength(1)
  })

  it('accepts a real Jooble-shaped response with numeric ids (documented example-response shape), deduplicates across both searches, and produces string externalId values', async () => {
    // Built as a raw JSON string, bypassing the searchResponse() test
    // helper's `id: string` typing, to exercise the real wire shape
    // Jooble's own documentation shows: an unquoted JSON number.
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            totalCount: 1,
            jobs: [
              {
                id: 987654321,
                title: 'Stage informatique',
                link: 'https://ma.jooble.org/desc/987654321',
                snippet: '<p>Stage de développement web avec React.</p>',
                type: 'Internship',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: SAMPLE_KEY })
    const result = await adapter.collect()

    expect(result.scanComplete).toBe(true)
    // The same numeric id, 987654321, comes back from both fixed searches —
    // deduplication must key on the transformed string, not the original
    // number, so exactly one candidate results.
    expect(result.fetchedCount).toBe(1)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.externalId).toBe('987654321')
    expect(typeof result.candidates[0]?.externalId).toBe('string')
  })

  it('marks the scan incomplete when totalCount exceeds the number of jobs returned, but still keeps the returned candidates', async () => {
    const fetchImpl = vi.fn(async () => searchResponse([{ id: '1', title: 'Stage informatique' }], 500))
    const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: SAMPLE_KEY })
    const result = await adapter.collect()

    expect(result.scanComplete).toBe(false)
    expect(result.candidates).toHaveLength(1)
    expect(result.errorSummary).toMatch(/pagination is disabled/)
  })

  it('marks the scan incomplete on a transient failure but preserves any candidates already collected from the other search', async () => {
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call++
      if (call === 1) return searchResponse([{ id: '1', title: 'Stage informatique' }])
      return new Response(null, { status: 500 })
    })
    const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: SAMPLE_KEY })
    const result = await adapter.collect()

    expect(result.scanComplete).toBe(false)
    expect(result.candidates).toHaveLength(1)
  })

  it('marks the scan incomplete on a timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    })
    const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: SAMPLE_KEY })
    const result = await adapter.collect()

    expect(result.scanComplete).toBe(false)
    expect(result.candidates).toEqual([])
  })

  it('marks the scan incomplete on an oversized response', async () => {
    const bigBody = JSON.stringify({ totalCount: 1, jobs: [], filler: 'x'.repeat(3_000_000) })
    const fetchImpl = vi.fn(async () => new Response(bigBody, { status: 200 }))
    const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: SAMPLE_KEY })
    const result = await adapter.collect()

    expect(result.scanComplete).toBe(false)
  })

  it('rejects a redirect outright instead of following it, and never sends a second request', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(`https://ma.jooble.org/api/${SAMPLE_KEY}`)
      return new Response(null, { status: 302, headers: { location: 'https://evil.example.com/steal' } })
    })
    const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: SAMPLE_KEY })
    const result = await adapter.collect()

    expect(result.scanComplete).toBe(false)
    // Two fixed searches, each rejecting its own single redirect attempt —
    // never following it to a second host.
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  describe('missing API key', () => {
    it('fails only the Jooble source when JOOBLE_API_KEY is unset, without ever calling fetch', async () => {
      const originalKey = process.env.JOOBLE_API_KEY
      delete process.env.JOOBLE_API_KEY
      try {
        const fetchImpl = vi.fn(async () => searchResponse([]))
        const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch })
        const result = await adapter.collect()

        expect(result.scanComplete).toBe(false)
        expect(result.candidates).toEqual([])
        expect(fetchImpl).not.toHaveBeenCalled()
        expect(result.errorSummary).toContain('JOOBLE_API_KEY is not configured')
      } finally {
        if (originalKey === undefined) delete process.env.JOOBLE_API_KEY
        else process.env.JOOBLE_API_KEY = originalKey
      }
    })

    it('fails only the Jooble source when JOOBLE_API_KEY is blank/whitespace', async () => {
      const originalKey = process.env.JOOBLE_API_KEY
      process.env.JOOBLE_API_KEY = '   '
      try {
        const fetchImpl = vi.fn(async () => searchResponse([]))
        const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch })
        const result = await adapter.collect()

        expect(result.scanComplete).toBe(false)
        expect(fetchImpl).not.toHaveBeenCalled()
      } finally {
        if (originalKey === undefined) delete process.env.JOOBLE_API_KEY
        else process.env.JOOBLE_API_KEY = originalKey
      }
    })
  })

  describe('secret redaction (docs/SECURITY.md M6A: the key lives in the URL path, not a query string or userinfo)', () => {
    it('never includes the API key in errorSummary on a failed request', async () => {
      const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }))
      const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: SAMPLE_KEY })
      const result = await adapter.collect()

      expect(result.errorSummary).toBeTruthy()
      expect(result.errorSummary).not.toContain(SAMPLE_KEY)
      expect(result.errorSummary).not.toContain(`https://ma.jooble.org/api/${SAMPLE_KEY}`)
      expect(result.errorSummary).toContain('Jooble API request failed')
    })

    it('never includes the API key anywhere console output would see it, for a thrown network error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const fetchImpl = vi.fn(async () => {
          throw new Error('ECONNRESET')
        })
        const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: SAMPLE_KEY })
        const result = await adapter.collect()

        expect(result.errorSummary).not.toContain(SAMPLE_KEY)
        // Nothing in this adapter logs directly, but assert defensively
        // that nothing was ever printed containing the key either.
        for (const call of consoleSpy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain(SAMPLE_KEY)
        }
      } finally {
        consoleSpy.mockRestore()
      }
    })

    it('never includes the API key in a rejected-redirect errorSummary', async () => {
      const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example.com/steal' } }))
      const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: SAMPLE_KEY })
      const result = await adapter.collect()

      expect(result.errorSummary).not.toContain(SAMPLE_KEY)
    })

    it('never includes the API key in the errorSummary for an oversized response', async () => {
      const bigBody = JSON.stringify({ totalCount: 1, jobs: [], filler: 'x'.repeat(3_000_000) })
      const fetchImpl = vi.fn(async () => new Response(bigBody, { status: 200 }))
      const adapter = createJoobleAdapter({ source: jooble, fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: SAMPLE_KEY })
      const result = await adapter.collect()

      expect(result.errorSummary).not.toContain(SAMPLE_KEY)
    })
  })
})
