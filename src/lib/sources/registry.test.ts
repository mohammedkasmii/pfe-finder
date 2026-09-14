import { describe, expect, it } from 'vitest'
import { validateAllowlistedHttpsUrl } from '../ingestion/urls'
import { SOURCE_REGISTRY, SourceConfigSchema } from './registry'

describe('SOURCE_REGISTRY', () => {
  it('configures exactly the three APPROVED_FOR_BUILD sources from docs/SOURCES.md', () => {
    expect(SOURCE_REGISTRY).toHaveLength(3)
    expect(SOURCE_REGISTRY.map((s) => s.key)).toEqual([
      'smartrecruiters-inetum',
      'smartrecruiters-devoteam',
      'smartrecruiters-mazars',
    ])
  })

  it('matches employer identifiers and countries from docs/SOURCES.md exactly', () => {
    const byKey = Object.fromEntries(SOURCE_REGISTRY.map((s) => [s.key, s]))
    expect(byKey['smartrecruiters-inetum']).toMatchObject({ employerIdentifier: 'Inetum2', countries: ['MA', 'FR'] })
    expect(byKey['smartrecruiters-devoteam']).toMatchObject({ employerIdentifier: 'Devoteam', countries: ['FR'] })
    expect(byKey['smartrecruiters-mazars']).toMatchObject({ employerIdentifier: 'MAZARS', countries: ['MA', 'FR'] })
  })

  it('every source only allows the two documented SmartRecruiters hosts', () => {
    for (const source of SOURCE_REGISTRY) {
      expect(source.allowedHosts).toEqual(['api.smartrecruiters.com', 'jobs.smartrecruiters.com'])
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
})
