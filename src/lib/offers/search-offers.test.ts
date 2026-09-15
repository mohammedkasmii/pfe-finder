import { describe, expect, it } from 'vitest'
import { signCursor } from './cursor'
import { InvalidCursorError } from './errors'
import { searchOffers, type SearchOffersParams } from './search-offers'
import type { OfferDbRow } from './public-offer'

const SECRET = 'a'.repeat(32)

function offerRow(overrides: Partial<OfferDbRow> = {}): OfferDbRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    source_key: 'smartrecruiters-inetum',
    external_id: 'abc123',
    source_url: 'https://jobs.smartrecruiters.com/Inetum2/abc123',
    apply_url: 'https://jobs.smartrecruiters.com/Inetum2/abc123/apply',
    canonical_url_hash: 'deadbeef',
    title: 'Stage Développeur',
    company: 'Inetum',
    description_text: 'Stage de développement web.',
    country: 'MA',
    city: 'Casablanca',
    region: null,
    work_mode: 'onsite',
    internship_type: 'internship',
    is_pfe: false,
    specialties: ['software-web-mobile'],
    technologies: ['React'],
    language: 'fr',
    published_at: '2026-01-01T00:00:00.000Z',
    first_seen_at: '2026-01-01T00:00:00.000Z',
    last_seen_at: '2026-01-02T00:00:00.000Z',
    inactive_at: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * Minimal fake mimicking just the two supabase-js call shapes searchOffers
 * needs: `.rpc('search_offers', args)` and `.from('sources').select(...).eq(...)`.
 */
function makeFakeClient(options: { rpcRows?: OfferDbRow[]; sourcesRows?: { last_success_at: string | null }[] }) {
  const rpcCalls: { fnName: string; args: Record<string, unknown> }[] = []
  const fromCalls: { table: string; calls: { method: string; args: unknown[] }[] }[] = []

  const client = {
    rpc(fnName: string, args: Record<string, unknown>) {
      rpcCalls.push({ fnName, args })
      return Promise.resolve({ data: options.rpcRows ?? [], error: null })
    },
    from(table: string) {
      const calls: { method: string; args: unknown[] }[] = []
      const entry = { table, calls }
      fromCalls.push(entry)
      const builder = {
        select(...args: unknown[]) {
          calls.push({ method: 'select', args })
          return builder
        },
        eq(...args: unknown[]) {
          calls.push({ method: 'eq', args })
          return builder
        },
        then(onfulfilled: (value: { data: unknown; error: null }) => unknown) {
          return Promise.resolve({ data: options.sourcesRows ?? [], error: null }).then(onfulfilled)
        },
      }
      return builder
    },
  }
  return { client, rpcCalls, fromCalls }
}

const baseParams: SearchOffersParams = { sort: 'newest', limit: 2 }

describe('searchOffers', () => {
  it('calls the RPC with all null filter args and p_limit = limit + 1 when no filters are given', async () => {
    const { client, rpcCalls } = makeFakeClient({ rpcRows: [] })

    await searchOffers(client as never, baseParams, { cursorSecret: SECRET })

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]!.fnName).toBe('search_offers')
    expect(rpcCalls[0]!.args).toEqual({
      p_query: null,
      p_country: null,
      p_city: null,
      p_specialty: null,
      p_technology: null,
      p_work_mode: null,
      p_pfe: null,
      p_language: null,
      p_sort: 'newest',
      p_cursor_value: null,
      p_cursor_id: null,
      p_limit: 3,
    })
  })

  it('passes every provided filter through to the RPC', async () => {
    const { client, rpcCalls } = makeFakeClient({ rpcRows: [] })
    const params: SearchOffersParams = {
      sort: 'newest',
      limit: 5,
      q: 'react',
      country: 'MA',
      city: 'Casablanca',
      specialty: 'software-web-mobile',
      technology: 'React',
      workMode: 'remote',
      pfe: true,
      language: 'fr',
    }

    await searchOffers(client as never, params, { cursorSecret: SECRET })

    expect(rpcCalls[0]!.args).toMatchObject({
      p_query: 'react',
      p_country: 'MA',
      p_city: 'Casablanca',
      p_specialty: 'software-web-mobile',
      p_technology: 'React',
      p_work_mode: 'remote',
      p_pfe: true,
      p_language: 'fr',
    })
  })

  it('returns exactly `limit` items and a non-null nextCursor when the RPC returns limit + 1 rows', async () => {
    const rows = [offerRow({ id: '1'.repeat(8) + '-1111-4111-8111-111111111111' }), offerRow({ id: '2'.repeat(8) + '-1111-4111-8111-111111111111' }), offerRow({ id: '3'.repeat(8) + '-1111-4111-8111-111111111111' })]
    const { client } = makeFakeClient({ rpcRows: rows })

    const result = await searchOffers(client as never, baseParams, { cursorSecret: SECRET })

    expect(result.items).toHaveLength(2)
    expect(result.nextCursor).not.toBeNull()
  })

  it('returns nextCursor null when the RPC returns limit or fewer rows', async () => {
    const rows = [offerRow()]
    const { client } = makeFakeClient({ rpcRows: rows })

    const result = await searchOffers(client as never, baseParams, { cursorSecret: SECRET })

    expect(result.items).toHaveLength(1)
    expect(result.nextCursor).toBeNull()
  })

  it('decodes a valid, matching-sort cursor and passes its value/id to the RPC', async () => {
    const cursor = signCursor({ sort: 'newest', value: '2026-01-01T00:00:00.000Z', id: offerRow().id }, SECRET)
    const { client, rpcCalls } = makeFakeClient({ rpcRows: [] })

    await searchOffers(client as never, { ...baseParams, cursor }, { cursorSecret: SECRET })

    expect(rpcCalls[0]!.args.p_cursor_value).toBe('2026-01-01T00:00:00.000Z')
    expect(rpcCalls[0]!.args.p_cursor_id).toBe(offerRow().id)
  })

  it('ignores a valid cursor whose sort does not match the current request (resets to page 1, no error)', async () => {
    const cursor = signCursor({ sort: 'recently-seen', value: '2026-01-01T00:00:00.000Z', id: offerRow().id }, SECRET)
    const { client, rpcCalls } = makeFakeClient({ rpcRows: [] })

    await searchOffers(client as never, { ...baseParams, sort: 'newest', cursor }, { cursorSecret: SECRET })

    expect(rpcCalls[0]!.args.p_cursor_value).toBeNull()
    expect(rpcCalls[0]!.args.p_cursor_id).toBeNull()
  })

  it('throws InvalidCursorError for a tampered cursor and never calls the RPC', async () => {
    const { client, rpcCalls } = makeFakeClient({ rpcRows: [] })

    await expect(
      searchOffers(client as never, { ...baseParams, cursor: 'tampered.cursor' }, { cursorSecret: SECRET }),
    ).rejects.toBeInstanceOf(InvalidCursorError)
    expect(rpcCalls).toHaveLength(0)
  })

  it('freshness.stale is true when there are zero enabled sources', async () => {
    const { client } = makeFakeClient({ rpcRows: [], sourcesRows: [] })
    const result = await searchOffers(client as never, baseParams, { cursorSecret: SECRET })
    expect(result.freshness.stale).toBe(true)
    expect(result.freshness.mostRecentSuccessAt).toBeNull()
  })

  it('freshness.stale is true when the most recent success is older than 48 hours', async () => {
    const oldDate = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString()
    const { client } = makeFakeClient({ rpcRows: [], sourcesRows: [{ last_success_at: oldDate }] })
    const result = await searchOffers(client as never, baseParams, { cursorSecret: SECRET })
    expect(result.freshness.stale).toBe(true)
  })

  it('freshness.stale is false when the most recent success is within 48 hours', async () => {
    const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
    const { client } = makeFakeClient({ rpcRows: [], sourcesRows: [{ last_success_at: recentDate }] })
    const result = await searchOffers(client as never, baseParams, { cursorSecret: SECRET })
    expect(result.freshness.stale).toBe(false)
    expect(result.freshness.mostRecentSuccessAt).toBe(recentDate)
  })

  it('freshness.stale is true when one enabled source is fresh but another has never succeeded (null)', async () => {
    const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
    const { client } = makeFakeClient({
      rpcRows: [],
      sourcesRows: [{ last_success_at: recentDate }, { last_success_at: null }],
    })
    const result = await searchOffers(client as never, baseParams, { cursorSecret: SECRET })
    // A single recently-succeeded source must NOT mask a sibling enabled
    // source that has never succeeded (M3 review finding 6).
    expect(result.freshness.stale).toBe(true)
    // The most recent successful timestamp is still informational/reported.
    expect(result.freshness.mostRecentSuccessAt).toBe(recentDate)
  })

  it('freshness.stale is true when one enabled source is fresh but another is older than 48 hours', async () => {
    const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
    const oldDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
    const { client } = makeFakeClient({
      rpcRows: [],
      sourcesRows: [{ last_success_at: recentDate }, { last_success_at: oldDate }],
    })
    const result = await searchOffers(client as never, baseParams, { cursorSecret: SECRET })
    expect(result.freshness.stale).toBe(true)
  })

  it('freshness.stale is false only when every enabled source succeeded within 48 hours', async () => {
    const recentDate1 = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
    const recentDate2 = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const { client } = makeFakeClient({
      rpcRows: [],
      sourcesRows: [{ last_success_at: recentDate1 }, { last_success_at: recentDate2 }],
    })
    const result = await searchOffers(client as never, baseParams, { cursorSecret: SECRET })
    expect(result.freshness.stale).toBe(false)
    expect(result.freshness.mostRecentSuccessAt).toBe(recentDate1)
  })

  it('maps items through the public offer allowlist (no internal fields)', async () => {
    const { client } = makeFakeClient({ rpcRows: [offerRow()] })
    const result = await searchOffers(client as never, baseParams, { cursorSecret: SECRET })
    expect(result.items[0]).not.toHaveProperty('canonical_url_hash')
    expect(result.items[0]).toMatchObject({ title: 'Stage Développeur', company: 'Inetum' })
  })
})
