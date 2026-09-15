import { describe, expect, it } from 'vitest'
import { DEFAULT_OFFERS_LIMIT, MAX_CURSOR_LENGTH, MAX_OFFERS_LIMIT, normalizeOffersSearchParams, OffersQuerySchema } from './query-schema'

describe('OffersQuerySchema (strict — used by GET /api/offers)', () => {
  it('accepts an empty query and applies defaults', () => {
    const result = OffersQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sort).toBe('newest')
      expect(result.data.limit).toBe(DEFAULT_OFFERS_LIMIT)
    }
  })

  it('accepts q up to 100 characters and rejects 101', () => {
    expect(OffersQuerySchema.safeParse({ q: 'x'.repeat(100) }).success).toBe(true)
    expect(OffersQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false)
  })

  it('treats injection-shaped q/city/technology values as ordinary bounded strings, not rejected here', () => {
    const payload = "'; drop table offers; --"
    expect(OffersQuerySchema.safeParse({ q: payload }).success).toBe(true)
    expect(OffersQuerySchema.safeParse({ city: payload }).success).toBe(true)
    expect(OffersQuerySchema.safeParse({ technology: '<script>alert(1)</script>' }).success).toBe(true)
  })

  it('accepts city up to 80 characters and rejects 81', () => {
    expect(OffersQuerySchema.safeParse({ city: 'x'.repeat(80) }).success).toBe(true)
    expect(OffersQuerySchema.safeParse({ city: 'x'.repeat(81) }).success).toBe(false)
  })

  it('accepts only MA or FR for country', () => {
    expect(OffersQuerySchema.safeParse({ country: 'MA' }).success).toBe(true)
    expect(OffersQuerySchema.safeParse({ country: 'FR' }).success).toBe(true)
    expect(OffersQuerySchema.safeParse({ country: 'US' }).success).toBe(false)
    expect(OffersQuerySchema.safeParse({ country: 'ma' }).success).toBe(false)
  })

  it('accepts only a documented specialty slug', () => {
    expect(OffersQuerySchema.safeParse({ specialty: 'data-ai' }).success).toBe(true)
    expect(OffersQuerySchema.safeParse({ specialty: 'not-a-real-slug' }).success).toBe(false)
  })

  it('accepts technology up to 40 characters and rejects 41', () => {
    expect(OffersQuerySchema.safeParse({ technology: 'x'.repeat(40) }).success).toBe(true)
    expect(OffersQuerySchema.safeParse({ technology: 'x'.repeat(41) }).success).toBe(false)
  })

  it('accepts only the four documented work modes', () => {
    for (const mode of ['onsite', 'hybrid', 'remote', 'unknown']) {
      expect(OffersQuerySchema.safeParse({ workMode: mode }).success).toBe(true)
    }
    expect(OffersQuerySchema.safeParse({ workMode: 'part-time' }).success).toBe(false)
  })

  it('pfe accepts only the literal string "true" and normalizes to boolean true; anything else is rejected', () => {
    const trueResult = OffersQuerySchema.safeParse({ pfe: 'true' })
    expect(trueResult.success).toBe(true)
    if (trueResult.success) expect(trueResult.data.pfe).toBe(true)

    expect(OffersQuerySchema.safeParse({ pfe: 'false' }).success).toBe(false)
    expect(OffersQuerySchema.safeParse({ pfe: '1' }).success).toBe(false)
  })

  it('pfe is undefined (never false) when omitted', () => {
    const result = OffersQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.pfe).toBeUndefined()
  })

  it('accepts only fr or en for language', () => {
    expect(OffersQuerySchema.safeParse({ language: 'fr' }).success).toBe(true)
    expect(OffersQuerySchema.safeParse({ language: 'en' }).success).toBe(true)
    expect(OffersQuerySchema.safeParse({ language: 'de' }).success).toBe(false)
  })

  it('accepts only newest or recently-seen for sort', () => {
    expect(OffersQuerySchema.safeParse({ sort: 'newest' }).success).toBe(true)
    expect(OffersQuerySchema.safeParse({ sort: 'recently-seen' }).success).toBe(true)
    expect(OffersQuerySchema.safeParse({ sort: 'oldest' }).success).toBe(false)
  })

  it(`rejects a cursor longer than ${MAX_CURSOR_LENGTH} characters`, () => {
    expect(OffersQuerySchema.safeParse({ cursor: 'x'.repeat(MAX_CURSOR_LENGTH) }).success).toBe(true)
    expect(OffersQuerySchema.safeParse({ cursor: 'x'.repeat(MAX_CURSOR_LENGTH + 1) }).success).toBe(false)
  })

  it('accepts limit 1 through 24, rejects 0 and 25, coerces numeric strings', () => {
    expect(OffersQuerySchema.safeParse({ limit: '1' }).success).toBe(true)
    expect(OffersQuerySchema.safeParse({ limit: String(MAX_OFFERS_LIMIT) }).success).toBe(true)
    expect(OffersQuerySchema.safeParse({ limit: '0' }).success).toBe(false)
    expect(OffersQuerySchema.safeParse({ limit: String(MAX_OFFERS_LIMIT + 1) }).success).toBe(false)
    expect(OffersQuerySchema.safeParse({ limit: 'abc' }).success).toBe(false)
  })

  it('defaults limit to 12 when omitted', () => {
    const result = OffersQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.limit).toBe(12)
  })

  it('rejects an unknown key instead of silently stripping it', () => {
    expect(OffersQuerySchema.safeParse({ country: 'MA', admin: 'true' }).success).toBe(false)
    expect(OffersQuerySchema.safeParse({ wat: '1' }).success).toBe(false)
  })
})

describe('normalizeOffersSearchParams (lenient — used by the /offers page)', () => {
  it('never throws and always returns a fully-defaulted query for an empty input', () => {
    const { query, ignoredKeys } = normalizeOffersSearchParams({})
    expect(query.sort).toBe('newest')
    expect(query.limit).toBe(DEFAULT_OFFERS_LIMIT)
    expect(ignoredKeys).toEqual([])
  })

  it('keeps a valid field and reports an invalid sibling field as ignored, without dropping the valid one', () => {
    const { query, ignoredKeys } = normalizeOffersSearchParams({ country: 'MA', specialty: 'not-a-real-slug' })
    expect(query.country).toBe('MA')
    expect(query.specialty).toBeUndefined()
    expect(ignoredKeys).toContain('specialty')
  })

  it('normalizes an invalid limit to the default instead of leaving it absent-and-unreported', () => {
    const { query, ignoredKeys } = normalizeOffersSearchParams({ limit: '999' })
    expect(query.limit).toBe(DEFAULT_OFFERS_LIMIT)
    expect(ignoredKeys).toContain('limit')
  })

  it('normalizes an invalid sort to the default', () => {
    const { query } = normalizeOffersSearchParams({ sort: 'oldest' })
    expect(query.sort).toBe('newest')
  })

  it('accepts a URLSearchParams instance directly', () => {
    const params = new URLSearchParams('country=FR&q=stage')
    const { query } = normalizeOffersSearchParams(params)
    expect(query.country).toBe('FR')
    expect(query.q).toBe('stage')
  })

  it('takes the first value of a repeated/array-valued key rather than throwing', () => {
    const { query } = normalizeOffersSearchParams({ country: ['MA', 'FR'] })
    expect(query.country).toBe('MA')
  })

  it('drops an oversized q instead of throwing, and reports it as ignored', () => {
    const { query, ignoredKeys } = normalizeOffersSearchParams({ q: 'x'.repeat(101) })
    expect(query.q).toBeUndefined()
    expect(ignoredKeys).toContain('q')
  })
})
