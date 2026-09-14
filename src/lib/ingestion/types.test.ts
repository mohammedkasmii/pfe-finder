import { describe, expect, it } from 'vitest'
import { NormalizedCandidateSchema } from './types'

const validCandidate = {
  sourceKey: 'smartrecruiters-inetum',
  externalId: 'abc123',
  sourceUrl: 'https://jobs.smartrecruiters.com/Inetum2/abc123',
  applyUrl: 'https://jobs.smartrecruiters.com/Inetum2/abc123/apply',
  canonicalUrlHash: 'deadbeef',
  title: 'Stage Développeur Full Stack',
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
}

describe('NormalizedCandidateSchema', () => {
  it('accepts a well-formed candidate', () => {
    expect(NormalizedCandidateSchema.safeParse(validCandidate).success).toBe(true)
  })

  it('rejects a non-MA/FR country', () => {
    expect(NormalizedCandidateSchema.safeParse({ ...validCandidate, country: 'US' }).success).toBe(false)
  })

  // Note: z.url() alone does not enforce https:// — HTTPS-and-allowlist
  // enforcement is validateAllowlistedHttpsUrl (src/lib/ingestion/urls.ts),
  // which runs before a candidate is ever constructed. This schema's job
  // is shape/bounds validation, not the security check itself.
  it('accepts (but does not itself enforce https on) a well-formed http URL', () => {
    expect(
      NormalizedCandidateSchema.safeParse({ ...validCandidate, sourceUrl: 'http://jobs.smartrecruiters.com/x' })
        .success,
    ).toBe(true)
  })

  it('rejects an oversized title', () => {
    expect(NormalizedCandidateSchema.safeParse({ ...validCandidate, title: 'x'.repeat(201) }).success).toBe(false)
  })

  it('rejects an unknown specialty slug', () => {
    expect(
      NormalizedCandidateSchema.safeParse({ ...validCandidate, specialties: ['not-a-real-slug'] }).success,
    ).toBe(false)
  })

  it('rejects a non-literal internshipType', () => {
    expect(
      NormalizedCandidateSchema.safeParse({ ...validCandidate, internshipType: 'full-time' }).success,
    ).toBe(false)
  })

  it('rejects an oversized descriptionText', () => {
    expect(
      NormalizedCandidateSchema.safeParse({ ...validCandidate, descriptionText: 'x'.repeat(5001) }).success,
    ).toBe(false)
  })

  it('accepts a null city/region and a null publishedAt', () => {
    expect(
      NormalizedCandidateSchema.safeParse({ ...validCandidate, city: null, region: null, publishedAt: null })
        .success,
    ).toBe(true)
  })
})
