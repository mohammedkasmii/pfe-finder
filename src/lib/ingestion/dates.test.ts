import { describe, expect, it } from 'vitest'
import { parseDateSafely } from './dates'

describe('parseDateSafely', () => {
  it('returns null when the value is absent', () => {
    expect(parseDateSafely(undefined)).toBeNull()
  })

  it('returns null for an invalid date string instead of throwing', () => {
    expect(() => parseDateSafely('not-a-date')).not.toThrow()
    expect(parseDateSafely('not-a-date')).toBeNull()
  })

  it('parses an ISO date string to its ISO form', () => {
    expect(parseDateSafely('2026-01-15T00:00:00Z')).toBe('2026-01-15T00:00:00.000Z')
  })

  it('parses a space-separated date-time string (Jooble\'s "updated" format)', () => {
    const result = parseDateSafely('2026-01-15 00:00:00')
    expect(result).not.toBeNull()
    expect(Number.isNaN(new Date(result!).getTime())).toBe(false)
  })
})
