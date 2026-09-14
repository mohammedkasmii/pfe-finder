import { describe, expect, it } from 'vitest'
import { normalizeLocation } from './location'

describe('normalizeLocation', () => {
  it('accepts ISO country codes directly', () => {
    expect(normalizeLocation({ country: 'MA' })).toEqual({ country: 'MA', city: null, region: null })
    expect(normalizeLocation({ country: 'FR' })).toEqual({ country: 'FR', city: null, region: null })
  })

  it('maps French country names to ISO codes', () => {
    expect(normalizeLocation({ country: 'Maroc' })?.country).toBe('MA')
    expect(normalizeLocation({ country: 'France' })?.country).toBe('FR')
  })

  it('maps English country names to ISO codes', () => {
    expect(normalizeLocation({ country: 'Morocco' })?.country).toBe('MA')
  })

  it('trims city and region', () => {
    expect(normalizeLocation({ country: 'MA', city: '  Casablanca  ', region: ' Grand Casablanca ' })).toEqual({
      country: 'MA',
      city: 'Casablanca',
      region: 'Grand Casablanca',
    })
  })

  it('returns null for an unrecognized country', () => {
    expect(normalizeLocation({ country: 'US' })).toBeNull()
  })

  it('returns null when country is missing', () => {
    expect(normalizeLocation({})).toBeNull()
    expect(normalizeLocation({ country: null })).toBeNull()
  })

  it('truncates an overlength city to 80 characters', () => {
    const result = normalizeLocation({ country: 'MA', city: 'x'.repeat(100) })
    expect(result?.city).toHaveLength(80)
  })

  it('treats a blank city as null', () => {
    expect(normalizeLocation({ country: 'MA', city: '   ' })?.city).toBeNull()
  })
})
