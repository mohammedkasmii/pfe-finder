import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const checkRateLimitMock = vi.fn()
const searchOffersMock = vi.fn()

vi.mock('@/lib/rate-limit/limiter', () => ({ checkRateLimit: checkRateLimitMock }))
vi.mock('@/lib/db/public-client', () => ({ getPublicSupabaseClient: () => ({}) }))
vi.mock('@/lib/offers/search-offers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/offers/search-offers')>('@/lib/offers/search-offers')
  return { ...actual, searchOffers: searchOffersMock }
})

const okResult = {
  items: [],
  nextCursor: null,
  freshness: { stale: false, mostRecentSuccessAt: '2026-01-01T00:00:00.000Z' },
}

function req(query: string): Request {
  return new Request(`https://example.com/api/offers${query}`)
}

describe('GET /api/offers', () => {
  beforeEach(() => {
    checkRateLimitMock.mockReset()
    checkRateLimitMock.mockResolvedValue({ allowed: true })
    searchOffersMock.mockReset()
    searchOffersMock.mockResolvedValue(okResult)
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns 200 with exactly items/nextCursor/freshness for a valid query', async () => {
    const { GET } = await import('./route')
    const response = await GET(req('?country=MA'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(['freshness', 'items', 'nextCursor'])
  })

  it('sets Cache-Control: no-store on success', async () => {
    const { GET } = await import('./route')
    const response = await GET(req(''))
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns 429 with Retry-After when the rate limiter denies', async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false })
    const { GET } = await import('./route')
    const response = await GET(req(''))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBeTruthy()
    const body = await response.json()
    expect(body).toEqual({ error: 'rate_limited' })
    expect(searchOffersMock).not.toHaveBeenCalled()
  })

  it('combines multiple filters into a single searchOffers call', async () => {
    const { GET } = await import('./route')
    await GET(req('?country=MA&specialty=data-ai&pfe=true&workMode=remote'))
    expect(searchOffersMock).toHaveBeenCalledTimes(1)
    const [, params] = searchOffersMock.mock.calls[0]!
    expect(params).toMatchObject({ country: 'MA', specialty: 'data-ai', pfe: true, workMode: 'remote' })
  })

  const invalidQueryCases: [string, string][] = [
    ['q too long', `?q=${'x'.repeat(101)}`],
    ['country invalid', '?country=US'],
    ['city too long', `?city=${'x'.repeat(81)}`],
    ['specialty invalid', '?specialty=not-a-real-slug'],
    ['technology too long', `?technology=${'x'.repeat(41)}`],
    ['workMode invalid', '?workMode=part-time'],
    ['pfe invalid', '?pfe=false'],
    ['language invalid', '?language=de'],
    ['sort invalid', '?sort=oldest'],
    ['limit zero', '?limit=0'],
    ['limit too large', '?limit=25'],
    ['limit non-numeric', '?limit=abc'],
  ]

  for (const [label, query] of invalidQueryCases) {
    it(`returns 400 invalid_query for ${label}`, async () => {
      const { GET } = await import('./route')
      const response = await GET(req(query))
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body).toEqual({ error: 'invalid_query' })
      expect(searchOffersMock).not.toHaveBeenCalled()
    })
  }

  it('returns 400 invalid_query for an unknown parameter, never reaching the data layer', async () => {
    const { GET } = await import('./route')
    const response = await GET(req('?country=MA&admin=true'))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toEqual({ error: 'invalid_query' })
    expect(searchOffersMock).not.toHaveBeenCalled()
  })

  it('returns 400 invalid_query for a completely unrecognized parameter', async () => {
    const { GET } = await import('./route')
    const response = await GET(req('?wat=1'))
    expect(response.status).toBe(400)
  })

  it('returns 400 invalid_query for a repeated parameter instead of silently using one value', async () => {
    const { GET } = await import('./route')
    const response = await GET(req('?country=MA&country=FR'))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toEqual({ error: 'invalid_query' })
    expect(searchOffersMock).not.toHaveBeenCalled()
  })

  it('returns 400 invalid_query for a repeated q parameter', async () => {
    const { GET } = await import('./route')
    const response = await GET(req('?q=one&q=two'))
    expect(response.status).toBe(400)
  })

  it('returns 400 invalid_query for a cursor over the length bound', async () => {
    const { GET } = await import('./route')
    const response = await GET(req(`?cursor=${'x'.repeat(513)}`))
    expect(response.status).toBe(400)
  })

  it('returns 400 invalid_cursor when searchOffers throws InvalidCursorError', async () => {
    const { InvalidCursorError } = await import('@/lib/offers/errors')
    searchOffersMock.mockRejectedValue(new InvalidCursorError())
    const { GET } = await import('./route')
    const response = await GET(req('?cursor=tampered'))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toEqual({ error: 'invalid_cursor' })
  })

  it('returns 503 service_unavailable on a generic thrown error, never echoing the message', async () => {
    searchOffersMock.mockRejectedValue(new Error('supabase connection string leaked: postgres://user:pass@host'))
    const { GET } = await import('./route')
    const response = await GET(req(''))
    expect(response.status).toBe(503)
    const bodyText = await response.text()
    expect(bodyText).not.toContain('postgres://')
    expect(bodyText).not.toContain('user:pass')
  })
})
