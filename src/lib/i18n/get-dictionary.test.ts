import { describe, expect, it } from 'vitest'
import { LOCALES } from './config'
import { getDictionary } from './get-dictionary'

describe('getDictionary', () => {
  it('returns a dictionary for every documented locale', () => {
    for (const locale of LOCALES) {
      const dictionary = getDictionary(locale)
      expect(dictionary.nav.home).toBeTruthy()
      expect(dictionary.howItWorks.steps).toHaveLength(3)
    }
  })

  it('never machine-translates identically between locales', () => {
    const fr = getDictionary('fr')
    const en = getDictionary('en')
    expect(fr.hero.title).not.toBe(en.hero.title)
    expect(fr.nav.home).not.toBe(en.nav.home)
  })

  it('presents the catalogue as covering all CS internships, with PFE only as a filter (docs/PRODUCT.md)', () => {
    // "PFE" alone (not part of the "PFE Finder" brand name) or an explicit
    // final-year/fin-d'études framing would claim the whole catalogue is
    // PFE-only, which docs/PRODUCT.md contradicts: PFE is one filter among
    // several, not the scope of the product.
    const finalYearOnlyPattern = /pfe(?!\s*finder)|final[- ]year|fin d.[ée]tudes/i
    for (const locale of LOCALES) {
      const { meta, hero } = getDictionary(locale)
      // The prominent, scope-defining copy must read as covering every CS
      // internship, not final-year ones only.
      expect(meta.title).not.toMatch(finalYearOnlyPattern)
      expect(hero.eyebrow).not.toMatch(finalYearOnlyPattern)
      expect(hero.title).not.toMatch(finalYearOnlyPattern)
      // PFE must still be surfaced somewhere as an available filter, not
      // erased from the copy entirely.
      const mentionsPfeAsAFilter =
        finalYearOnlyPattern.test(meta.description) || finalYearOnlyPattern.test(hero.description)
      expect(mentionsPfeAsAFilter).toBe(true)
    }
  })

  it('keeps the six documented specialties in both locales', () => {
    for (const locale of LOCALES) {
      const { items } = getDictionary(locale).specialties
      expect(Object.keys(items)).toEqual([
        'softwareWebMobile',
        'dataAi',
        'cybersecurity',
        'cloudDevops',
        'systemsNetworks',
        'qaTesting',
      ])
    }
  })
})
