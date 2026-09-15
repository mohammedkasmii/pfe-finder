import { describe, expect, it } from 'vitest'
import { SOURCE_REGISTRY, type JoobleSourceConfig } from '../registry'
import { normalizeJoobleJob } from './normalize'
import type { JoobleJob } from './schema'

const jooble = SOURCE_REGISTRY.find((s) => s.key === 'jooble-morocco')! as JoobleSourceConfig

function job(overrides: Partial<JoobleJob> = {}): JoobleJob {
  return {
    id: 'abc123',
    title: 'Stage informatique — Développeur Full Stack',
    location: 'Casablanca, Maroc',
    snippet: '<p>Stage de développement web avec React et Node.js.</p>',
    type: 'Internship',
    link: 'https://ma.jooble.org/desc/abc123',
    company: 'Acme Maroc',
    updated: '2026-01-15 00:00:00',
    ...overrides,
  }
}

describe('normalizeJoobleJob', () => {
  it('produces a candidate for a valid CS internship', () => {
    const candidate = normalizeJoobleJob(job(), jooble)
    expect(candidate).not.toBeNull()
    expect(candidate?.externalId).toBe('abc123')
    expect(candidate?.country).toBe('MA')
    expect(candidate?.city).toBe('Casablanca')
    expect(candidate?.technologies).toContain('React')
    expect(candidate?.sourceUrl).toBe('https://ma.jooble.org/desc/abc123')
    expect(candidate?.applyUrl).toBe('https://ma.jooble.org/desc/abc123')
  })

  it('maps an explicit PFE phrase to isPfe: true', () => {
    const candidate = normalizeJoobleJob(
      job({ title: 'Stage de fin d’études — Data Engineer', snippet: '<p>Stage de fin d’études, Python et SQL.</p>' }),
      jooble,
    )
    expect(candidate?.isPfe).toBe(true)
  })

  it('returns null when classification rejects the posting (non-CS domain)', () => {
    const candidate = normalizeJoobleJob(
      job({ title: 'Stage Marketing Digital', snippet: '<p>Stage marketing, réseaux sociaux.</p>' }),
      jooble,
    )
    expect(candidate).toBeNull()
  })

  it('does not weaken or bypass the classifier: a clearly senior title is rejected even with type="Internship"', () => {
    const candidate = normalizeJoobleJob(
      job({ title: 'Développeur Java/Angular - Sénior', type: 'Internship' }),
      jooble,
    )
    expect(candidate).toBeNull()
  })

  it('treats type="Internship" as an authoritative positive signal, accepting a role with no internship keyword in the title', () => {
    const candidate = normalizeJoobleJob(
      job({ title: 'Développeur Full Stack', snippet: '<p>Développement web avec React et Node.js.</p>', type: 'Internship' }),
      jooble,
    )
    expect(candidate).not.toBeNull()
  })

  it('does not treat an unrelated type value as any signal (falls back to the title keyword)', () => {
    const candidate = normalizeJoobleJob(
      job({ title: 'Développeur Full Stack', snippet: '<p>Développement web.</p>', type: 'Full-time' }),
      jooble,
    )
    // No "stage"/"internship" in the title and no positive type signal —
    // the shared classifier's neutral-without-title-keyword rule rejects it.
    expect(candidate).toBeNull()
  })

  it('returns null when the job link is not HTTPS on the allowlisted host', () => {
    const candidate = normalizeJoobleJob(job({ link: 'https://evil.example.com/desc/abc123' }), jooble)
    expect(candidate).toBeNull()
  })

  it('returns null when the job link is not HTTPS', () => {
    const candidate = normalizeJoobleJob(job({ link: 'http://ma.jooble.org/desc/abc123' }), jooble)
    expect(candidate).toBeNull()
  })

  it('strips malicious markup from the snippet before classification/storage', () => {
    const candidate = normalizeJoobleJob(
      job({
        snippet:
          '<script>alert(1)</script><style>body{color:red}</style><p onclick="steal()">Stage développement web avec React.</p>',
      }),
      jooble,
    )
    expect(candidate).not.toBeNull()
    expect(candidate?.descriptionText).not.toMatch(/<script|<style|onclick/i)
  })

  it('sets publishedAt to null instead of throwing on an invalid "updated" date', () => {
    expect(() => normalizeJoobleJob(job({ updated: 'not-a-date' }), jooble)).not.toThrow()
    const candidate = normalizeJoobleJob(job({ updated: 'not-a-date' }), jooble)
    expect(candidate?.publishedAt).toBeNull()
  })

  it('sets publishedAt to null when "updated" is absent', () => {
    const candidate = normalizeJoobleJob(job({ updated: undefined }), jooble)
    expect(candidate?.publishedAt).toBeNull()
  })

  it('maps city conservatively: a country-only location becomes null, not a fabricated city', () => {
    const candidate = normalizeJoobleJob(job({ location: 'Maroc' }), jooble)
    expect(candidate?.city).toBeNull()
  })

  it('maps city to null when location is absent', () => {
    const candidate = normalizeJoobleJob(job({ location: undefined }), jooble)
    expect(candidate?.city).toBeNull()
  })

  it('falls back to the source name when company is absent', () => {
    const candidate = normalizeJoobleJob(job({ company: undefined }), jooble)
    expect(candidate?.company).toBe('Jooble Morocco')
  })
})
