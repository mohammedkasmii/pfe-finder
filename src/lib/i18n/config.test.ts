import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, isLocale, LOCALES } from './config'

describe('isLocale', () => {
  it('accepts every documented locale', () => {
    for (const locale of LOCALES) {
      expect(isLocale(locale)).toBe(true)
    }
  })

  it('rejects unsupported strings', () => {
    expect(isLocale('de')).toBe(false)
    expect(isLocale('')).toBe(false)
  })

  it('rejects null and undefined without throwing', () => {
    expect(isLocale(null)).toBe(false)
    expect(isLocale(undefined)).toBe(false)
  })

  it('defaults to French', () => {
    expect(DEFAULT_LOCALE).toBe('fr')
  })
})
