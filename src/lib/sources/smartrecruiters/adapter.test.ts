import { describe, expect, it, vi } from 'vitest'
import { SOURCE_REGISTRY } from '../registry'
import { createSmartRecruitersAdapter } from './adapter'

const inetum = SOURCE_REGISTRY.find((s) => s.key === 'smartrecruiters-inetum')! // MA + FR
const devoteam = SOURCE_REGISTRY.find((s) => s.key === 'smartrecruiters-devoteam')! // FR only

function listingResponse(content: { id: string; name: string }[], totalFound: number, offset = 0) {
  return new Response(JSON.stringify({ totalFound, offset, limit: 100, content }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function detailResponse(id: string, name: string, descriptionText: string, country = 'MA') {
  return new Response(
    JSON.stringify({
      id,
      name,
      applyUrl: `https://jobs.smartrecruiters.com/Inetum2/${id}`,
      location: { city: 'Casablanca', country },
      jobAd: { sections: { jobDescription: { text: `<p>${descriptionText}</p>` } } },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function urlPath(url: string): string {
  return new URL(url).pathname
}

describe('createSmartRecruitersAdapter', () => {
  it('collects all postings on a single page and reports a complete scan', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (urlPath(url).endsWith('/postings')) {
        return listingResponse([{ id: '1', name: 'Stage Développeur' }], 1)
      }
      return detailResponse('1', 'Stage Développeur', 'Stage de développement web avec React.')
    })

    const adapter = createSmartRecruitersAdapter({ source: inetum, fetchImpl: fetchImpl as unknown as typeof fetch })
    const result = await adapter.collect()

    expect(result.scanComplete).toBe(true)
    expect(result.candidates).toHaveLength(1)
    expect(result.acceptedCount).toBe(1)
    expect(result.rejectedCount).toBe(0)
    expect(result.fetchedCount).toBe(1)
  })

  it('rejects a non-CS posting but keeps the scan complete', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (urlPath(url).endsWith('/postings')) {
        return listingResponse([{ id: '1', name: 'Stage RH' }], 1)
      }
      return detailResponse('1', 'Stage Ressources Humaines', 'Stage RH, recrutement et paie.')
    })

    const adapter = createSmartRecruitersAdapter({ source: inetum, fetchImpl: fetchImpl as unknown as typeof fetch })
    const result = await adapter.collect()

    expect(result.scanComplete).toBe(true)
    expect(result.candidates).toHaveLength(0)
    expect(result.rejectedCount).toBe(1)
  })

  it('paginates across multiple listing pages until totalFound is exhausted', async () => {
    // devoteam is FR-only, so this exercises pagination without also
    // exercising the (separately tested) multi-country traversal.
    let listingCalls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (urlPath(url).endsWith('/postings')) {
        listingCalls++
        const offset = Number(new URL(url).searchParams.get('offset'))
        if (offset === 0) return listingResponse([{ id: '1', name: 'Stage Dev' }], 2, 0)
        return listingResponse([{ id: '2', name: 'Stage Dev 2' }], 2, 1)
      }
      const id = urlPath(url).split('/').pop()!
      return detailResponse(id, 'Stage Développeur', 'Stage de développement web avec React.', 'FR')
    })

    const adapter = createSmartRecruitersAdapter({
      source: devoteam,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pageSize: 1,
    })
    const result = await adapter.collect()

    expect(listingCalls).toBe(2)
    expect(result.candidates).toHaveLength(2)
    expect(result.scanComplete).toBe(true)
  })

  it('scopes listing requests to each configured country independently, using fixed country parameters', async () => {
    const listingCountries: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      if (urlPath(url).endsWith('/postings')) {
        listingCountries.push(new URL(url).searchParams.get('country')!)
        return listingResponse([], 0)
      }
      throw new Error('unexpected detail fetch')
    })

    // inetum is configured for MA + FR.
    const adapter = createSmartRecruitersAdapter({ source: inetum, fetchImpl: fetchImpl as unknown as typeof fetch })
    await adapter.collect()

    expect(listingCountries.sort()).toEqual(['fr', 'ma'])
  })

  it('deduplicates a posting ID that appears in more than one country listing before fetching details', async () => {
    let detailCalls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (urlPath(url).endsWith('/postings')) {
        // Same posting reported under both MA and FR listings.
        return listingResponse([{ id: 'shared-1', name: 'Stage Développeur' }], 1)
      }
      detailCalls++
      return detailResponse('shared-1', 'Stage Développeur', 'Stage de développement web avec React.')
    })

    const adapter = createSmartRecruitersAdapter({ source: inetum, fetchImpl: fetchImpl as unknown as typeof fetch })
    const result = await adapter.collect()

    expect(detailCalls).toBe(1)
    expect(result.fetchedCount).toBe(1)
    expect(result.candidates).toHaveLength(1)
  })

  it('marks the scan incomplete and returns no candidates when the listing fetch always fails', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }))

    const adapter = createSmartRecruitersAdapter({ source: inetum, fetchImpl: fetchImpl as unknown as typeof fetch })
    const result = await adapter.collect()

    expect(result.scanComplete).toBe(false)
    expect(result.candidates).toEqual([])
    expect(result.errorSummary).toBeTruthy()
    expect(result.errorSummary!.length).toBeLessThanOrEqual(500)
  })

  it('marks the scan incomplete when one detail fetch times out, but still collects other postings', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (urlPath(url).endsWith('/postings')) {
        return listingResponse(
          [
            { id: '1', name: 'Stage Développeur' },
            { id: '2', name: 'Stage Data' },
          ],
          2,
        )
      }
      const id = urlPath(url).split('/').pop()!
      if (id === '1') {
        const error = new Error('aborted')
        error.name = 'AbortError'
        throw error
      }
      return detailResponse('2', 'Stage Data Engineer', 'Stage data engineer, Python et SQL.')
    })

    const adapter = createSmartRecruitersAdapter({
      source: inetum,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      // Avoid real retry delays slowing the test: 0 retries is enough to
      // exercise the "still incomplete after retries" path deterministically.
    })
    const result = await adapter.collect()

    expect(result.scanComplete).toBe(false)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.externalId).toBe('2')
  })

  it('treats a 404 detail fetch as a deterministic rejection without affecting scan completeness', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (urlPath(url).endsWith('/postings')) {
        return listingResponse([{ id: '1', name: 'Stage Développeur' }], 1)
      }
      return new Response(null, { status: 404 })
    })

    const adapter = createSmartRecruitersAdapter({ source: inetum, fetchImpl: fetchImpl as unknown as typeof fetch })
    const result = await adapter.collect()

    expect(result.scanComplete).toBe(true)
    expect(result.rejectedCount).toBe(1)
    expect(result.candidates).toHaveLength(0)
  })
})
