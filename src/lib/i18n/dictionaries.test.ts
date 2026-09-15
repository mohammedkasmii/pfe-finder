import { describe, expect, it } from 'vitest'
import { LOCALES } from './config'
import { getDictionary } from './get-dictionary'

/**
 * TypeScript's `satisfies Dictionary` on each dictionary file already
 * guarantees both locales share the exact same shape at compile time.
 * This test instead catches a copy-paste-and-forgot-to-translate mistake:
 * no leaf string value may be empty.
 */
function collectEmptyStringPaths(value: unknown, path: string): string[] {
  if (typeof value === 'string') {
    return value.trim().length === 0 ? [path] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectEmptyStringPaths(item, `${path}[${index}]`))
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) => collectEmptyStringPaths(nested, path ? `${path}.${key}` : key))
  }
  return []
}

describe('dictionaries', () => {
  for (const locale of LOCALES) {
    it(`has no empty string values (${locale})`, () => {
      const dictionary = getDictionary(locale)
      expect(collectEmptyStringPaths(dictionary, '')).toEqual([])
    })
  }
})
