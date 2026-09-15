import { describe, expect, it } from 'vitest'
import { NormalizedCandidateSchema } from '../../ingestion/types'
import { SOURCE_REGISTRY } from '../registry'
import { normalizeSmartRecruitersPosting } from './normalize'
import type { SmartRecruitersDetailResponse } from './schema'

const inetum = SOURCE_REGISTRY.find((s) => s.key === 'smartrecruiters-inetum')!
const devoteam = SOURCE_REGISTRY.find((s) => s.key === 'smartrecruiters-devoteam')!

function detail(overrides: Partial<SmartRecruitersDetailResponse> = {}): SmartRecruitersDetailResponse {
  return {
    id: 'abc123',
    name: 'Stage Développeur Full Stack',
    applyUrl: 'https://jobs.smartrecruiters.com/Inetum2/abc123',
    releasedDate: '2026-01-15T00:00:00Z',
    location: { city: 'Casablanca', country: 'MA' },
    jobAd: {
      sections: {
        jobDescription: { text: '<p>Stage de développement web avec React et Node.js.</p>' },
      },
    },
    ...overrides,
  }
}

describe('normalizeSmartRecruitersPosting', () => {
  it('produces a schema-valid NormalizedCandidate for a valid CS internship', () => {
    const candidate = normalizeSmartRecruitersPosting(detail(), inetum)
    expect(candidate).not.toBeNull()
    expect(NormalizedCandidateSchema.safeParse(candidate).success).toBe(true)
    expect(candidate?.externalId).toBe('abc123')
    expect(candidate?.country).toBe('MA')
    expect(candidate?.city).toBe('Casablanca')
    expect(candidate?.technologies).toContain('React')
  })

  it('returns null when classification rejects the posting (HR-flavored)', () => {
    const candidate = normalizeSmartRecruitersPosting(
      detail({
        name: 'Stage Ressources Humaines',
        jobAd: { sections: { jobDescription: { text: '<p>Stage RH, recrutement et paie.</p>' } } },
      }),
      inetum,
    )
    expect(candidate).toBeNull()
  })

  it('returns null when the location country is not in the source\'s configured countries', () => {
    // Devoteam is FR-only; a Morocco location must be rejected.
    const candidate = normalizeSmartRecruitersPosting(
      detail({ location: { city: 'Casablanca', country: 'MA' } }),
      devoteam,
    )
    expect(candidate).toBeNull()
  })

  it('returns null when applyUrl is not an allowlisted SmartRecruiters URL', () => {
    const candidate = normalizeSmartRecruitersPosting(
      detail({ applyUrl: 'https://evil.example.com/apply' }),
      inetum,
    )
    expect(candidate).toBeNull()
  })

  it('falls back to the constructed source URL when applyUrl is absent', () => {
    const candidate = normalizeSmartRecruitersPosting(detail({ applyUrl: undefined }), inetum)
    expect(candidate?.applyUrl).toBe(candidate?.sourceUrl)
  })

  it('sets publishedAt to null when releasedDate is absent', () => {
    const candidate = normalizeSmartRecruitersPosting(detail({ releasedDate: undefined }), inetum)
    expect(candidate?.publishedAt).toBeNull()
  })

  it('sets publishedAt to null instead of throwing on an invalid releasedDate (regression)', () => {
    expect(() => normalizeSmartRecruitersPosting(detail({ releasedDate: 'not-a-date' }), inetum)).not.toThrow()
    const candidate = normalizeSmartRecruitersPosting(detail({ releasedDate: 'not-a-date' }), inetum)
    expect(candidate?.publishedAt).toBeNull()
  })

  it('detects French descriptions as language "fr"', () => {
    const candidate = normalizeSmartRecruitersPosting(detail(), inetum)
    expect(candidate?.language).toBe('fr')
  })

  it('returns null when experienceLevel.id is an explicit non-internship value (post-deployment correction: permanent role mentioning "stage de fin d\'études" only as a qualification)', () => {
    const candidate = normalizeSmartRecruitersPosting(
      detail({
        name: 'Consultant confirmé - Stratégie et Transformation - Data & IA F/H',
        jobAd: {
          sections: {
            qualifications: {
              text: '<p>Vous avez réalisé un stage de fin d’études ou une première expérience en conseil data/IA.</p>',
            },
          },
        },
        experienceLevel: { id: 'associate' },
        typeOfEmployment: { id: 'permanent' },
      }),
      inetum,
    )
    expect(candidate).toBeNull()
  })

  it('accepts when experienceLevel.id is "internship" even though typeOfEmployment.id is "permanent" (confirmed valid PFE listing shape)', () => {
    const candidate = normalizeSmartRecruitersPosting(
      detail({ experienceLevel: { id: 'internship' }, typeOfEmployment: { id: 'permanent' } }),
      inetum,
    )
    expect(candidate).not.toBeNull()
  })

  it('detects English descriptions as language "en"', () => {
    const candidate = normalizeSmartRecruitersPosting(
      detail({
        name: 'Software Engineering Intern',
        jobAd: {
          sections: {
            jobDescription: {
              text: '<p>We are looking for a software engineering intern to join the backend team and work with Java.</p>',
            },
          },
        },
      }),
      inetum,
    )
    expect(candidate?.language).toBe('en')
  })
})
