import { describe, expect, it } from 'vitest'
import {
  SmartRecruitersDetailResponseSchema,
  SmartRecruitersListingItemSchema,
  SmartRecruitersListingResponseSchema,
} from './schema'

/**
 * SmartRecruiters' Posting API is untrusted upstream input
 * (docs/SECURITY.md). These bounds are practical maximums for a real
 * response — a field far outside them is itself a signal of a malformed
 * or hostile response and should be rejected here, at the schema
 * boundary, rather than silently accepted and only bounded later by an
 * ad hoc `.slice()` downstream.
 */
describe('SmartRecruitersListingItemSchema bounds', () => {
  it('accepts a well-formed item', () => {
    expect(SmartRecruitersListingItemSchema.safeParse({ id: '1', name: 'Stage Développeur' }).success).toBe(true)
  })

  it('rejects an oversized id', () => {
    expect(SmartRecruitersListingItemSchema.safeParse({ id: 'x'.repeat(201), name: 'x' }).success).toBe(false)
  })

  it('rejects an oversized name', () => {
    expect(SmartRecruitersListingItemSchema.safeParse({ id: '1', name: 'x'.repeat(501) }).success).toBe(false)
  })
})

describe('SmartRecruitersListingResponseSchema bounds', () => {
  it('rejects a content array larger than the practical page-size bound', () => {
    const content = Array.from({ length: 501 }, (_, i) => ({ id: String(i), name: 'x' }))
    expect(
      SmartRecruitersListingResponseSchema.safeParse({ totalFound: 501, offset: 0, limit: 501, content }).success,
    ).toBe(false)
  })

  it('accepts a content array at the bound', () => {
    const content = Array.from({ length: 500 }, (_, i) => ({ id: String(i), name: 'x' }))
    expect(
      SmartRecruitersListingResponseSchema.safeParse({ totalFound: 500, offset: 0, limit: 500, content }).success,
    ).toBe(true)
  })
})

describe('SmartRecruitersDetailResponseSchema bounds', () => {
  const base = { id: '1', name: 'Stage Développeur' }

  it('accepts a well-formed detail response', () => {
    expect(SmartRecruitersDetailResponseSchema.safeParse(base).success).toBe(true)
  })

  it('rejects an oversized name', () => {
    expect(SmartRecruitersDetailResponseSchema.safeParse({ ...base, name: 'x'.repeat(501) }).success).toBe(false)
  })

  it('rejects an oversized applyUrl', () => {
    const hugeUrl = `https://jobs.smartrecruiters.com/${'x'.repeat(2100)}`
    expect(SmartRecruitersDetailResponseSchema.safeParse({ ...base, applyUrl: hugeUrl }).success).toBe(false)
  })

  it('rejects an oversized releasedDate string', () => {
    expect(SmartRecruitersDetailResponseSchema.safeParse({ ...base, releasedDate: 'x'.repeat(65) }).success).toBe(
      false,
    )
  })

  it('rejects an oversized location field', () => {
    expect(
      SmartRecruitersDetailResponseSchema.safeParse({ ...base, location: { city: 'x'.repeat(201) } }).success,
    ).toBe(false)
  })

  it('rejects an oversized jobAd section text', () => {
    expect(
      SmartRecruitersDetailResponseSchema.safeParse({
        ...base,
        jobAd: { sections: { jobDescription: { text: 'x'.repeat(50_001) } } },
      }).success,
    ).toBe(false)
  })

  it('accepts a jobAd section text at the bound', () => {
    expect(
      SmartRecruitersDetailResponseSchema.safeParse({
        ...base,
        jobAd: { sections: { jobDescription: { text: 'x'.repeat(50_000) } } },
      }).success,
    ).toBe(true)
  })

  it('accepts experienceLevel.id and typeOfEmployment.id when present (post-deployment classification correction)', () => {
    const result = SmartRecruitersDetailResponseSchema.safeParse({
      ...base,
      experienceLevel: { id: 'internship' },
      typeOfEmployment: { id: 'permanent' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.experienceLevel?.id).toBe('internship')
      expect(result.data.typeOfEmployment?.id).toBe('permanent')
    }
  })

  it('accepts a response with experienceLevel/typeOfEmployment absent (common case)', () => {
    expect(SmartRecruitersDetailResponseSchema.safeParse(base).success).toBe(true)
  })

  it('rejects an oversized experienceLevel.id', () => {
    expect(
      SmartRecruitersDetailResponseSchema.safeParse({ ...base, experienceLevel: { id: 'x'.repeat(101) } }).success,
    ).toBe(false)
  })
})
