import { describe, expect, it } from 'vitest'
import { JoobleJobSchema, JoobleSearchResponseSchema } from './schema'

const validJob = {
  id: '12345',
  title: 'Stage informatique',
  location: 'Casablanca, Maroc',
  snippet: '<p>Stage de développement web.</p>',
  type: 'Internship',
  link: 'https://ma.jooble.org/desc/12345',
  company: 'Acme',
  updated: '2026-01-15 00:00:00',
}

describe('JoobleJobSchema bounds', () => {
  it('accepts a well-formed job', () => {
    expect(JoobleJobSchema.safeParse(validJob).success).toBe(true)
  })

  it('accepts a job with only the required fields', () => {
    expect(JoobleJobSchema.safeParse({ id: '1', title: 'Stage', link: 'https://ma.jooble.org/desc/1' }).success).toBe(
      true,
    )
  })

  it('rejects a missing id', () => {
    const rest: Record<string, unknown> = { ...validJob }
    delete rest.id
    expect(JoobleJobSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects a missing link', () => {
    const rest: Record<string, unknown> = { ...validJob }
    delete rest.link
    expect(JoobleJobSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects an oversized id', () => {
    expect(JoobleJobSchema.safeParse({ ...validJob, id: 'x'.repeat(201) }).success).toBe(false)
  })

  it('rejects an oversized title', () => {
    expect(JoobleJobSchema.safeParse({ ...validJob, title: 'x'.repeat(501) }).success).toBe(false)
  })

  it('rejects an oversized snippet', () => {
    expect(JoobleJobSchema.safeParse({ ...validJob, snippet: 'x'.repeat(20_001) }).success).toBe(false)
  })

  it('accepts a snippet at the bound', () => {
    expect(JoobleJobSchema.safeParse({ ...validJob, snippet: 'x'.repeat(20_000) }).success).toBe(true)
  })

  it('rejects an oversized location', () => {
    expect(JoobleJobSchema.safeParse({ ...validJob, location: 'x'.repeat(301) }).success).toBe(false)
  })

  it('rejects a non-URL link', () => {
    expect(JoobleJobSchema.safeParse({ ...validJob, link: 'not a url' }).success).toBe(false)
  })

  it('rejects an oversized link', () => {
    const hugeUrl = `https://ma.jooble.org/${'x'.repeat(2100)}`
    expect(JoobleJobSchema.safeParse({ ...validJob, link: hugeUrl }).success).toBe(false)
  })
})

describe('JoobleJobSchema — id accepts both official-API numeric and string shapes', () => {
  it('accepts a numeric id (Jooble\'s documented example-response shape) and transforms it to a string', () => {
    const result = JoobleJobSchema.safeParse({ ...validJob, id: 12345 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe('12345')
      expect(typeof result.data.id).toBe('string')
    }
  })

  it('still accepts an existing string id, unchanged', () => {
    const result = JoobleJobSchema.safeParse({ ...validJob, id: '12345' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.id).toBe('12345')
  })

  it('accepts a numeric id of 0', () => {
    const result = JoobleJobSchema.safeParse({ ...validJob, id: 0 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.id).toBe('0')
  })

  it('rejects a negative numeric id', () => {
    expect(JoobleJobSchema.safeParse({ ...validJob, id: -1 }).success).toBe(false)
  })

  it('rejects a fractional numeric id', () => {
    expect(JoobleJobSchema.safeParse({ ...validJob, id: 123.45 }).success).toBe(false)
  })

  it('rejects an unsafe-integer numeric id', () => {
    expect(JoobleJobSchema.safeParse({ ...validJob, id: Number.MAX_SAFE_INTEGER + 10 }).success).toBe(false)
  })

  it('rejects non-finite numeric ids (NaN, Infinity)', () => {
    expect(JoobleJobSchema.safeParse({ ...validJob, id: Number.NaN }).success).toBe(false)
    expect(JoobleJobSchema.safeParse({ ...validJob, id: Number.POSITIVE_INFINITY }).success).toBe(false)
    expect(JoobleJobSchema.safeParse({ ...validJob, id: Number.NEGATIVE_INFINITY }).success).toBe(false)
  })

  it('rejects a boolean id', () => {
    expect(JoobleJobSchema.safeParse({ ...validJob, id: true }).success).toBe(false)
  })

  it('rejects a null id', () => {
    expect(JoobleJobSchema.safeParse({ ...validJob, id: null }).success).toBe(false)
  })

  it('rejects an object id', () => {
    expect(JoobleJobSchema.safeParse({ ...validJob, id: { value: 12345 } }).success).toBe(false)
  })
})

describe('JoobleSearchResponseSchema bounds', () => {
  it('accepts a well-formed response', () => {
    expect(JoobleSearchResponseSchema.safeParse({ totalCount: 1, jobs: [validJob] }).success).toBe(true)
  })

  it('accepts an empty result set', () => {
    expect(JoobleSearchResponseSchema.safeParse({ totalCount: 0, jobs: [] }).success).toBe(true)
  })

  it('rejects a negative totalCount', () => {
    expect(JoobleSearchResponseSchema.safeParse({ totalCount: -1, jobs: [] }).success).toBe(false)
  })

  it('rejects a jobs array larger than the practical page-size bound', () => {
    const jobs = Array.from({ length: 201 }, (_, i) => ({ ...validJob, id: String(i) }))
    expect(JoobleSearchResponseSchema.safeParse({ totalCount: 201, jobs }).success).toBe(false)
  })

  it('rejects a malformed job inside an otherwise valid response', () => {
    expect(JoobleSearchResponseSchema.safeParse({ totalCount: 1, jobs: [{ id: '1' }] }).success).toBe(false)
  })

  it('accepts a complete response whose jobs carry numeric ids (Jooble\'s documented example-response shape) without failing the whole response', () => {
    const jobs = [
      { ...validJob, id: 111 },
      { ...validJob, id: 222 },
    ]
    const result = JoobleSearchResponseSchema.safeParse({ totalCount: 2, jobs })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.jobs.map((j) => j.id)).toEqual(['111', '222'])
    }
  })
})
