import { describe, expect, it } from 'vitest'
import { toPublicOfferDetail, toPublicOfferSummary, type OfferDbRow } from './public-offer'

function row(overrides: Partial<OfferDbRow> = {}): OfferDbRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    source_key: 'smartrecruiters-inetum',
    external_id: 'abc123',
    source_url: 'https://jobs.smartrecruiters.com/Inetum2/abc123',
    apply_url: 'https://jobs.smartrecruiters.com/Inetum2/abc123/apply',
    canonical_url_hash: 'deadbeef',
    title: 'Stage Développeur',
    company: 'Inetum',
    description_text: 'Stage de développement web.',
    country: 'MA',
    city: 'Casablanca',
    region: null,
    work_mode: 'onsite',
    internship_type: 'internship',
    is_pfe: false,
    specialties: ['software-web-mobile'],
    technologies: ['React'],
    language: 'fr',
    published_at: '2026-01-01T00:00:00.000Z',
    first_seen_at: '2026-01-01T00:00:00.000Z',
    last_seen_at: '2026-01-02T00:00:00.000Z',
    inactive_at: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('toPublicOfferSummary', () => {
  it('maps exactly the documented public fields, nothing more', () => {
    const result = toPublicOfferSummary(row())
    expect(Object.keys(result).sort()).toEqual(
      [
        'id',
        'title',
        'company',
        'country',
        'city',
        'region',
        'workMode',
        'isPfe',
        'specialties',
        'technologies',
        'language',
        'publishedAt',
        'sourceName',
        'attributionUrl',
      ].sort(),
    )
  })

  it('never leaks internal ingestion fields', () => {
    const result = toPublicOfferSummary(row()) as unknown as Record<string, unknown>
    for (const internalField of [
      'canonical_url_hash',
      'external_id',
      'source_key',
      'status',
      'created_at',
      'updated_at',
      'first_seen_at',
      'internship_type',
    ]) {
      expect(result).not.toHaveProperty(internalField)
    }
  })

  it('resolves sourceName/attributionUrl from the source registry', () => {
    const result = toPublicOfferSummary(row({ source_key: 'smartrecruiters-devoteam' }))
    expect(result.sourceName).toBe('Devoteam')
    expect(result.attributionUrl).toBe('https://jobs.smartrecruiters.com/Devoteam')
  })

  it('falls back to a generic name/attribution for an unknown source_key rather than throwing', () => {
    const result = toPublicOfferSummary(row({ source_key: 'no-longer-configured' }))
    expect(result.sourceName).toBeTruthy()
    expect(() => new URL(result.attributionUrl)).not.toThrow()
  })
})

describe('toPublicOfferDetail', () => {
  it('extends the summary with descriptionText, sourceUrl, applyUrl, lastSeenAt', () => {
    const result = toPublicOfferDetail(row())
    expect(result.descriptionText).toBe('Stage de développement web.')
    expect(result.sourceUrl).toBe('https://jobs.smartrecruiters.com/Inetum2/abc123')
    expect(result.applyUrl).toBe('https://jobs.smartrecruiters.com/Inetum2/abc123/apply')
    expect(result.lastSeenAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('nulls out applyUrl when its host is not on the source\'s allowed hosts (stale/tampered data)', () => {
    const result = toPublicOfferDetail(row({ apply_url: 'https://evil.example/apply' }))
    expect(result.applyUrl).toBeNull()
    // sourceUrl is independently valid and must not be affected.
    expect(result.sourceUrl).toBe('https://jobs.smartrecruiters.com/Inetum2/abc123')
  })

  it('nulls out sourceUrl when it is not https', () => {
    const result = toPublicOfferDetail(row({ source_url: 'http://jobs.smartrecruiters.com/Inetum2/abc123' }))
    expect(result.sourceUrl).toBeNull()
  })

  it('nulls out both URLs when source_key is not in the registry', () => {
    const result = toPublicOfferDetail(row({ source_key: 'no-longer-configured' }))
    expect(result.sourceUrl).toBeNull()
    expect(result.applyUrl).toBeNull()
  })
})
