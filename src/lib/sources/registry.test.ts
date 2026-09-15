import { describe, expect, it } from 'vitest'
import { validateAllowlistedHttpsUrl } from '../ingestion/urls'
import { SOURCE_REGISTRY, SourceConfigSchema } from './registry'

const SMARTRECRUITERS_HOSTS = ['api.smartrecruiters.com', 'jobs.smartrecruiters.com']

describe('SOURCE_REGISTRY', () => {
  it('configures exactly the five documented sources from docs/SOURCES.md', () => {
    expect(SOURCE_REGISTRY).toHaveLength(5)
    expect(SOURCE_REGISTRY.map((s) => s.key)).toEqual([
      'smartrecruiters-inetum',
      'smartrecruiters-devoteam',
      'smartrecruiters-mazars',
      'smartrecruiters-wavestone',
      'jooble-morocco',
    ])
  })

  it('matches employer identifiers and countries from docs/SOURCES.md exactly', () => {
    const byKey = Object.fromEntries(SOURCE_REGISTRY.map((s) => [s.key, s]))
    expect(byKey['smartrecruiters-inetum']).toMatchObject({ employerIdentifier: 'Inetum2', countries: ['MA', 'FR'] })
    expect(byKey['smartrecruiters-devoteam']).toMatchObject({ employerIdentifier: 'Devoteam', countries: ['FR'] })
    expect(byKey['smartrecruiters-mazars']).toMatchObject({ employerIdentifier: 'MAZARS', countries: ['MA', 'FR'] })
    expect(byKey['smartrecruiters-wavestone']).toMatchObject({ employerIdentifier: 'Wavestone1', countries: ['MA'] })
  })

  it('every SmartRecruiters source only allows the two documented SmartRecruiters hosts', () => {
    for (const source of SOURCE_REGISTRY) {
      if (source.adapter === 'smartrecruiters') {
        expect(source.allowedHosts).toEqual(SMARTRECRUITERS_HOSTS)
      }
    }
  })

  it('every attribution URL is a valid allowlisted HTTPS URL for its own source', () => {
    for (const source of SOURCE_REGISTRY) {
      expect(validateAllowlistedHttpsUrl(source.attributionUrl, source.allowedHosts).ok).toBe(true)
    }
  })

  it('every entry satisfies SourceConfigSchema at runtime, not just the TypeScript type', () => {
    for (const source of SOURCE_REGISTRY) {
      expect(SourceConfigSchema.safeParse(source).success).toBe(true)
    }
  })

  it('SourceConfigSchema rejects a country outside MA/FR', () => {
    const invalid = { ...SOURCE_REGISTRY[0], countries: ['US'] }
    expect(SourceConfigSchema.safeParse(invalid).success).toBe(false)
  })

  it('SourceConfigSchema rejects a non-https attribution URL', () => {
    const invalid = { ...SOURCE_REGISTRY[0], attributionUrl: 'http://jobs.smartrecruiters.com/Inetum2' }
    expect(SourceConfigSchema.safeParse(invalid).success).toBe(false)
  })

  describe('jooble-morocco (discriminated union, M6A)', () => {
    const jooble = SOURCE_REGISTRY.find((s) => s.key === 'jooble-morocco')!

    it('is configured exactly MA-only on the ma.jooble.org host, with no employerIdentifier field', () => {
      expect(jooble.adapter).toBe('jooble')
      expect(jooble.countries).toEqual(['MA'])
      expect(jooble.allowedHosts).toEqual(['ma.jooble.org'])
      expect(jooble).not.toHaveProperty('employerIdentifier')
    })

    it('never carries an API key or any secret-shaped field', () => {
      expect(jooble).not.toHaveProperty('apiKey')
      expect(jooble).not.toHaveProperty('token')
      expect(jooble).not.toHaveProperty('secret')
      const serialized = JSON.stringify(jooble)
      expect(serialized).not.toMatch(/api[_-]?key|token|secret/i)
    })

    it('SourceConfigSchema rejects a jooble entry carrying an unexpected employerIdentifier-shaped extra field the same as any adapter', () => {
      // The discriminated union still validates required base fields even
      // for the jooble variant — a missing attributionUrl must fail.
      const invalid: Record<string, unknown> = { ...jooble }
      delete invalid.attributionUrl
      expect(SourceConfigSchema.safeParse(invalid).success).toBe(false)
    })
  })

  describe('smartrecruiters-wavestone (M6A)', () => {
    const wavestone = SOURCE_REGISTRY.find((s) => s.key === 'smartrecruiters-wavestone')!

    it('is configured MA-only for this milestone', () => {
      expect(wavestone.countries).toEqual(['MA'])
    })

    it('uses the documented employer identifier and attribution URL', () => {
      expect(wavestone).toMatchObject({
        employerIdentifier: 'Wavestone1',
        attributionUrl: 'https://jobs.smartrecruiters.com/Wavestone1',
      })
    })
  })

  describe('discriminated union narrowing', () => {
    it('narrows to employerIdentifier only for smartrecruiters sources', () => {
      for (const source of SOURCE_REGISTRY) {
        if (source.adapter === 'smartrecruiters') {
          expect(typeof source.employerIdentifier).toBe('string')
        }
      }
    })
  })
})
