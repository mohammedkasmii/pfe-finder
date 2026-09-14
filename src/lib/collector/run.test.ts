import { describe, expect, it } from 'vitest'
import { computeCanonicalUrlHash } from '../ingestion/urls'
import type { CollectionResult, NormalizedCandidate } from '../ingestion/types'
import { SOURCE_REGISTRY, type SourceConfig } from '../sources/registry'
import type { SourceAdapter } from '../sources/adapter'
import { FakeIngestionRepository } from './fake-repository'
import { runCollector } from './run'

const inetumSource = SOURCE_REGISTRY.find((s) => s.key === 'smartrecruiters-inetum')!
const devoteamSource = SOURCE_REGISTRY.find((s) => s.key === 'smartrecruiters-devoteam')!

function candidate(overrides: Partial<NormalizedCandidate> = {}): NormalizedCandidate {
  const sourceUrl = overrides.sourceUrl ?? 'https://jobs.smartrecruiters.com/Inetum2/abc123'
  return {
    sourceKey: 'smartrecruiters-inetum',
    externalId: 'abc123',
    sourceUrl,
    applyUrl: 'https://jobs.smartrecruiters.com/Inetum2/abc123/apply',
    canonicalUrlHash: computeCanonicalUrlHash(sourceUrl),
    title: 'Stage Développeur',
    company: 'Inetum',
    descriptionText: 'Stage de développement web.',
    country: 'MA',
    city: 'Casablanca',
    region: null,
    workMode: 'onsite',
    internshipType: 'internship',
    isPfe: false,
    specialties: ['software-web-mobile'],
    technologies: ['React'],
    language: 'fr',
    publishedAt: null,
    ...overrides,
  }
}

function fakeAdapter(source: SourceConfig, result: CollectionResult): SourceAdapter {
  return { sourceKey: source.key, source, collect: async () => result }
}

function throwingAdapter(source: SourceConfig, error: Error): SourceAdapter {
  return {
    sourceKey: source.key,
    source,
    collect: async () => {
      throw error
    },
  }
}

const completeResult = (candidates: NormalizedCandidate[]): CollectionResult => ({
  sourceKey: 'smartrecruiters-inetum',
  candidates,
  fetchedCount: candidates.length,
  acceptedCount: candidates.length,
  rejectedCount: 0,
  scanComplete: true,
})

describe('runCollector', () => {
  it('successful import: stores the offer and records a succeeded run', async () => {
    const repository = new FakeIngestionRepository()
    const summaries = await runCollector({
      repository,
      adapters: [fakeAdapter(inetumSource, completeResult([candidate()]))],
    })

    expect(summaries[0]).toMatchObject({ status: 'succeeded', scanComplete: true, upsertedCount: 1 })
    expect(repository.offers.get('smartrecruiters-inetum:abc123')).toBeDefined()
  })

  it('duplicate import: retrying the same successful input creates no duplicate and preserves first_seen_at', async () => {
    const repository = new FakeIngestionRepository()
    const adapters = [fakeAdapter(inetumSource, completeResult([candidate()]))]

    await runCollector({ repository, adapters })
    const firstSeenAfterFirstRun = repository.offers.get('smartrecruiters-inetum:abc123')!.first_seen_at

    await new Promise((resolve) => setTimeout(resolve, 5))
    await runCollector({ repository, adapters })

    expect(repository.offers.size).toBe(1)
    const stored = repository.offers.get('smartrecruiters-inetum:abc123')!
    expect(stored.first_seen_at).toBe(firstSeenAfterFirstRun)
    expect(stored.last_seen_at).not.toBe(firstSeenAfterFirstRun)
  })

  it('updated offer: a changed field on a re-run is reflected in storage', async () => {
    const repository = new FakeIngestionRepository()
    await runCollector({
      repository,
      adapters: [fakeAdapter(inetumSource, completeResult([candidate({ title: 'Old title' })]))],
    })

    await runCollector({
      repository,
      adapters: [fakeAdapter(inetumSource, completeResult([candidate({ title: 'New title' })]))],
    })

    expect(repository.offers.get('smartrecruiters-inetum:abc123')?.title).toBe('New title')
  })

  it('partial scan: preserves an existing active offer for the same source that the scan does not mention', async () => {
    const repository = new FakeIngestionRepository()
    await runCollector({
      repository,
      adapters: [fakeAdapter(inetumSource, completeResult([candidate({ externalId: 'existing' })]))],
    })

    const partialResult: CollectionResult = {
      sourceKey: 'smartrecruiters-inetum',
      candidates: [],
      fetchedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      scanComplete: false,
      errorSummary: 'listing fetch failed: timeout',
    }
    await runCollector({ repository, adapters: [fakeAdapter(inetumSource, partialResult)] })

    expect(repository.offers.get('smartrecruiters-inetum:existing')?.status).toBe('active')
  })

  it('complete scan with a missing offer: deactivates it', async () => {
    const repository = new FakeIngestionRepository()
    await runCollector({
      repository,
      adapters: [fakeAdapter(inetumSource, completeResult([candidate({ externalId: 'gone' })]))],
    })

    await runCollector({
      repository,
      adapters: [fakeAdapter(inetumSource, completeResult([]))],
    })

    const stored = repository.offers.get('smartrecruiters-inetum:gone')!
    expect(stored.status).toBe('inactive')
    expect(stored.inactive_at).not.toBeNull()
  })

  it('timeout/malformed-response adapter result: run recorded as failed, existing offers untouched', async () => {
    const repository = new FakeIngestionRepository()
    await runCollector({
      repository,
      adapters: [fakeAdapter(inetumSource, completeResult([candidate({ externalId: 'existing' })]))],
    })

    const failingResult: CollectionResult = {
      sourceKey: 'smartrecruiters-inetum',
      candidates: [],
      fetchedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      scanComplete: false,
      errorSummary: 'listing fetch failed: unexpected status 500',
    }
    const summaries = await runCollector({
      repository,
      adapters: [fakeAdapter(inetumSource, failingResult)],
    })

    expect(summaries[0]).toMatchObject({ status: 'failed', scanComplete: false })
    expect(repository.runs.get('run-2')).toMatchObject({ status: 'failed', error_code: 'incomplete_scan' })
    expect(repository.offers.get('smartrecruiters-inetum:existing')?.status).toBe('active')
  })

  it('adapter throws: caught, run recorded failed with a bounded error summary, no crash', async () => {
    const repository = new FakeIngestionRepository()
    const bigStack = 'Error: boom\n' + '  at somewhere\n'.repeat(200)
    const summaries = await runCollector({
      repository,
      adapters: [throwingAdapter(inetumSource, new Error(bigStack))],
    })

    expect(summaries[0]).toMatchObject({ status: 'failed', scanComplete: false })
    const run = repository.runs.get('run-1')!
    expect(run.error_code).toBe('collector_exception')
    expect(run.error_summary!.length).toBeLessThanOrEqual(500)
  })

  it('database failure: upsertOffers rejecting is caught and recorded as a failed run', async () => {
    const repository = new FakeIngestionRepository()
    repository.upsertOffers = async () => {
      throw new Error('connection refused')
    }

    const summaries = await runCollector({
      repository,
      adapters: [fakeAdapter(inetumSource, completeResult([candidate()]))],
    })

    expect(summaries[0]).toMatchObject({ status: 'failed' })
    expect(repository.runs.get('run-1')).toMatchObject({ status: 'failed', error_code: 'collector_exception' })
  })

  it('every recorded error_summary stays within the 500-character bound', async () => {
    const repository = new FakeIngestionRepository()
    await runCollector({
      repository,
      adapters: [throwingAdapter(inetumSource, new Error('x'.repeat(1000)))],
    })

    for (const run of repository.runs.values()) {
      if (run.error_summary) expect(run.error_summary.length).toBeLessThanOrEqual(500)
    }
  })

  it('runs multiple adapters independently, one summary per source', async () => {
    const repository = new FakeIngestionRepository()
    const summaries = await runCollector({
      repository,
      adapters: [
        fakeAdapter(inetumSource, completeResult([candidate()])),
        fakeAdapter(
          devoteamSource,
          completeResult([
            candidate({
              sourceKey: 'smartrecruiters-devoteam',
              externalId: 'xyz',
              country: 'FR',
              sourceUrl: 'https://jobs.smartrecruiters.com/Devoteam/xyz',
              applyUrl: 'https://jobs.smartrecruiters.com/Devoteam/xyz/apply',
            }),
          ]),
        ),
      ],
    })

    expect(summaries).toHaveLength(2)
    expect(summaries.map((s) => s.sourceKey)).toEqual(['smartrecruiters-inetum', 'smartrecruiters-devoteam'])
  })

  it('skips a disabled source entirely: no run started, adapter never called', async () => {
    const repository = new FakeIngestionRepository()
    repository.disableSource('smartrecruiters-inetum')
    let collectCalled = false
    const adapter: SourceAdapter = {
      sourceKey: 'smartrecruiters-inetum',
      source: inetumSource,
      collect: async () => {
        collectCalled = true
        return completeResult([candidate()])
      },
    }

    const summaries = await runCollector({ repository, adapters: [adapter] })

    expect(collectCalled).toBe(false)
    expect(summaries[0]).toMatchObject({ sourceKey: 'smartrecruiters-inetum', status: 'skipped' })
    expect(repository.runs.size).toBe(0)
  })

  it('a completed scan sets sources.last_success_at', async () => {
    const repository = new FakeIngestionRepository()
    await runCollector({
      repository,
      adapters: [fakeAdapter(inetumSource, completeResult([candidate()]))],
    })

    expect(repository.sources.get('smartrecruiters-inetum')?.last_success_at).not.toBeNull()
  })

  it('a failed/partial scan sets sources.last_error_at without erasing a prior last_success_at', async () => {
    const repository = new FakeIngestionRepository()
    await runCollector({
      repository,
      adapters: [fakeAdapter(inetumSource, completeResult([candidate()]))],
    })
    const successTimestamp = repository.sources.get('smartrecruiters-inetum')!.last_success_at

    await new Promise((resolve) => setTimeout(resolve, 5))

    const failingResult: CollectionResult = {
      sourceKey: 'smartrecruiters-inetum',
      candidates: [],
      fetchedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      scanComplete: false,
      errorSummary: 'listing fetch failed: timeout',
    }
    await runCollector({ repository, adapters: [fakeAdapter(inetumSource, failingResult)] })

    const source = repository.sources.get('smartrecruiters-inetum')!
    expect(source.last_error_at).not.toBeNull()
    expect(source.last_success_at).toBe(successTimestamp)
  })

  it('canonical collision: the next complete scan collapses two existing active rows to one current representation with no stale duplicate', async () => {
    const repository = new FakeIngestionRepository()
    const urlX = 'https://jobs.smartrecruiters.com/Inetum2/ext-x'
    const urlY = 'https://jobs.smartrecruiters.com/Inetum2/ext-y'

    // Two distinct existing active offers, each with its own canonical URL.
    await runCollector({
      repository,
      adapters: [
        fakeAdapter(
          inetumSource,
          completeResult([
            candidate({ externalId: 'ext-x', sourceUrl: urlX, applyUrl: `${urlX}/apply` }),
            candidate({ externalId: 'ext-y', sourceUrl: urlY, applyUrl: `${urlY}/apply` }),
          ]),
        ),
      ],
    })
    expect(repository.offers.get('smartrecruiters-inetum:ext-x')?.status).toBe('active')
    expect(repository.offers.get('smartrecruiters-inetum:ext-y')?.status).toBe('active')

    // The next complete scan reports ext-x at a URL that now normalizes to
    // the SAME canonical fingerprint ext-y already holds (e.g. the two
    // postings were merged upstream) — not merely a rename of ext-x's own
    // URL, but a genuine collision with a DIFFERENT existing identity.
    await runCollector({
      repository,
      adapters: [
        fakeAdapter(
          inetumSource,
          completeResult([
            candidate({
              externalId: 'ext-x',
              title: 'Stage Développeur (merged)',
              sourceUrl: urlY,
              applyUrl: `${urlY}/apply`,
            }),
          ]),
        ),
      ],
    })

    const representative = repository.offers.get('smartrecruiters-inetum:ext-y')!
    const staleRow = repository.offers.get('smartrecruiters-inetum:ext-x')!

    // One current active representation, holding the fresh data...
    expect(representative.status).toBe('active')
    expect(representative.title).toBe('Stage Développeur (merged)')
    // ...and no stale duplicate left active under the old identity: ext-x
    // was never "seen" this cycle (only ext-y's identity was represented),
    // so the complete-scan finalization correctly deactivates it.
    expect(staleRow.status).toBe('inactive')

    const activeRepresentationsForHash = [...repository.offers.values()].filter(
      (offer) => offer.canonical_url_hash === representative.canonical_url_hash && offer.status === 'active',
    )
    expect(activeRepresentationsForHash).toHaveLength(1)
  })
})
