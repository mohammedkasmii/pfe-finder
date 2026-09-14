import { describe, expect, it } from 'vitest'
import { SOURCE_REGISTRY } from '../sources/registry'
import { computeCanonicalUrlHash } from './urls'
import { sanitizeCollectionResult } from './validate-collection-result'
import type { NormalizedCandidate } from './types'

const inetumSource = SOURCE_REGISTRY.find((s) => s.key === 'smartrecruiters-inetum')!

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

const validResult = {
  sourceKey: 'smartrecruiters-inetum',
  candidates: [candidate()],
  fetchedCount: 1,
  acceptedCount: 1,
  rejectedCount: 0,
  scanComplete: true,
}

describe('sanitizeCollectionResult', () => {
  it('passes a well-formed result through unchanged', () => {
    const result = sanitizeCollectionResult(validResult, inetumSource)
    expect(result.candidates).toHaveLength(1)
    expect(result.scanComplete).toBe(true)
  })

  it('never throws on a completely malformed top-level shape', () => {
    expect(() => sanitizeCollectionResult('not an object', inetumSource)).not.toThrow()
    expect(() => sanitizeCollectionResult(undefined, inetumSource)).not.toThrow()
    expect(() => sanitizeCollectionResult({ candidates: 'not an array' }, inetumSource)).not.toThrow()
  })

  it('returns a safe, incomplete-scan result when the top-level shape is malformed', () => {
    const result = sanitizeCollectionResult({ garbage: true }, inetumSource)
    expect(result.candidates).toEqual([])
    expect(result.scanComplete).toBe(false)
    expect(result.sourceKey).toBe('smartrecruiters-inetum')
  })

  it('drops a candidate that fails NormalizedCandidateSchema without throwing or invalidating the rest', () => {
    const malformed = { ...candidate(), title: '' } // fails min(1)
    const result = sanitizeCollectionResult(
      { ...validResult, candidates: [candidate(), malformed], acceptedCount: 2, rejectedCount: 0 },
      inetumSource,
    )
    expect(result.candidates).toHaveLength(1)
    expect(result.rejectedCount).toBe(1)
  })

  it('drops a candidate whose sourceKey does not match the adapter actually being run (cross-source guard)', () => {
    const wrongSource = candidate({ sourceKey: 'smartrecruiters-devoteam' })
    const result = sanitizeCollectionResult(
      { ...validResult, candidates: [candidate(), wrongSource], acceptedCount: 2 },
      inetumSource,
    )
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.sourceKey).toBe('smartrecruiters-inetum')
    expect(result.rejectedCount).toBe(1)
  })

  it('always stamps the result sourceKey to the expected one, never trusting the raw value', () => {
    const result = sanitizeCollectionResult({ ...validResult, sourceKey: 'attacker-controlled' }, inetumSource)
    expect(result.sourceKey).toBe('smartrecruiters-inetum')
  })

  it('acceptedCount always reflects the actual number of retained candidates', () => {
    const malformed = { ...candidate(), externalId: '' }
    const result = sanitizeCollectionResult({ ...validResult, candidates: [candidate(), malformed], acceptedCount: 2 }, inetumSource)
    expect(result.acceptedCount).toBe(1)
  })

  // Adversarial cases confirmed against a real run: sanitizeCollectionResult
  // previously accepted a `https://evil.example` source/apply URL and a
  // non-SHA-256 canonical hash as a valid candidate, because it only had
  // the source's key (not its allowedHosts) to check against.
  it('drops a candidate whose sourceUrl is not on the expected source\'s allowed hosts', () => {
    const hostile = candidate({ sourceUrl: 'https://evil.example/abc123', canonicalUrlHash: computeCanonicalUrlHash('https://evil.example/abc123') })
    const result = sanitizeCollectionResult({ ...validResult, candidates: [hostile] }, inetumSource)
    expect(result.candidates).toHaveLength(0)
    expect(result.rejectedCount).toBe(1)
  })

  it('drops a candidate whose applyUrl is not on the expected source\'s allowed hosts', () => {
    const hostile = candidate({ applyUrl: 'https://evil.example/apply' })
    const result = sanitizeCollectionResult({ ...validResult, candidates: [hostile] }, inetumSource)
    expect(result.candidates).toHaveLength(0)
    expect(result.rejectedCount).toBe(1)
  })

  it('drops a candidate whose sourceUrl is not https', () => {
    const hostile = candidate({ sourceUrl: 'http://jobs.smartrecruiters.com/Inetum2/abc123' })
    const result = sanitizeCollectionResult({ ...validResult, candidates: [hostile] }, inetumSource)
    expect(result.candidates).toHaveLength(0)
  })

  it('drops a candidate whose canonicalUrlHash is not a 64-character lowercase SHA-256 hex digest', () => {
    const hostile = candidate({ canonicalUrlHash: 'not-a-real-hash' })
    const result = sanitizeCollectionResult({ ...validResult, candidates: [hostile] }, inetumSource)
    expect(result.candidates).toHaveLength(0)
    expect(result.rejectedCount).toBe(1)
  })

  it('drops a candidate whose canonicalUrlHash is well-formed hex but does not match its own sourceUrl', () => {
    const otherHash = computeCanonicalUrlHash('https://jobs.smartrecruiters.com/Inetum2/some-other-posting')
    const hostile = candidate({ canonicalUrlHash: otherHash })
    const result = sanitizeCollectionResult({ ...validResult, candidates: [hostile] }, inetumSource)
    expect(result.candidates).toHaveLength(0)
    expect(result.rejectedCount).toBe(1)
  })

  it('drops a canonicalUrlHash that is uppercase (schema requires lowercase hex)', () => {
    const uppercaseHash = computeCanonicalUrlHash('https://jobs.smartrecruiters.com/Inetum2/abc123').toUpperCase()
    const hostile = candidate({ canonicalUrlHash: uppercaseHash })
    const result = sanitizeCollectionResult({ ...validResult, candidates: [hostile] }, inetumSource)
    expect(result.candidates).toHaveLength(0)
  })
})
