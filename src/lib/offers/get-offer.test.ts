import { describe, expect, it } from 'vitest'
import { getOfferById } from './get-offer'
import { GetOfferError } from './errors'
import type { OfferDbRow } from './public-offer'

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

function makeFakeClient(result: { data: OfferDbRow | null; error: unknown }) {
  const calls: { method: string; args: unknown[] }[] = []
  const builder = {
    select(...args: unknown[]) {
      calls.push({ method: 'select', args })
      return builder
    },
    eq(...args: unknown[]) {
      calls.push({ method: 'eq', args })
      return builder
    },
    maybeSingle() {
      calls.push({ method: 'maybeSingle', args: [] })
      return Promise.resolve(result)
    },
  }
  const client = {
    from(table: string) {
      expect(table).toBe('offers')
      return builder
    },
  }
  return { client, calls }
}

/** A `getClient` factory that records whether it was ever invoked — the
 * key assertion for "validate the UUID before constructing the Supabase
 * client": a malformed id must never even call this. */
function makeClientFactory(result: { data: OfferDbRow | null; error: unknown }) {
  const { client, calls } = makeFakeClient(result)
  let constructed = false
  const getClient = () => {
    constructed = true
    return client as never
  }
  return { getClient, calls, wasConstructed: () => constructed }
}

function throwingClientFactory(): { getClient: () => never; wasConstructed: () => boolean } {
  let constructed = false
  return {
    getClient: () => {
      constructed = true
      throw new Error('supabaseUrl is required.')
    },
    wasConstructed: () => constructed,
  }
}

describe('getOfferById', () => {
  it('never constructs the Supabase client for a malformed id', async () => {
    const { getClient, wasConstructed } = makeClientFactory({ data: null, error: null })
    expect(await getOfferById(getClient, 'not-a-uuid')).toBeNull()
    expect(wasConstructed()).toBe(false)

    const second = makeClientFactory({ data: null, error: null })
    expect(await getOfferById(second.getClient, '')).toBeNull()
    expect(second.wasConstructed()).toBe(false)

    const third = makeClientFactory({ data: null, error: null })
    expect(await getOfferById(third.getClient, 'x'.repeat(300))).toBeNull()
    expect(third.wasConstructed()).toBe(false)
  })

  it('a malformed id never throws even when client construction would fail (e.g. unconfigured Supabase)', async () => {
    const { getClient, wasConstructed } = throwingClientFactory()
    await expect(getOfferById(getClient, 'not-a-uuid')).resolves.toBeNull()
    expect(wasConstructed()).toBe(false)
  })

  it('returns null (not-found) when no row matches a well-formed id', async () => {
    const { getClient } = makeClientFactory({ data: null, error: null })
    expect(await getOfferById(getClient, '11111111-1111-4111-8111-111111111111')).toBeNull()
  })

  it('queries with status = active', async () => {
    const { getClient, calls } = makeClientFactory({ data: null, error: null })
    await getOfferById(getClient, '11111111-1111-4111-8111-111111111111')
    expect(calls.some((c) => c.method === 'eq' && c.args[0] === 'status' && c.args[1] === 'active')).toBe(true)
  })

  it('returns the mapped detail object for a matching active row', async () => {
    const { getClient } = makeClientFactory({ data: offerRow(), error: null })
    const result = await getOfferById(getClient, '11111111-1111-4111-8111-111111111111')
    expect(result).toMatchObject({ title: 'Stage Développeur', descriptionText: 'Stage de développement web.' })
  })

  it('throws a typed GetOfferError on a database error, distinct from not-found', async () => {
    const { getClient } = makeClientFactory({ data: null, error: { message: 'connection refused: postgres://user:pass@host' } })
    await expect(getOfferById(getClient, '11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(GetOfferError)
  })

  it('the GetOfferError message never contains the raw database error text', async () => {
    const { getClient } = makeClientFactory({ data: null, error: { message: 'connection refused: postgres://user:pass@host' } })
    try {
      await getOfferById(getClient, '11111111-1111-4111-8111-111111111111')
      throw new Error('expected getOfferById to throw')
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(GetOfferError)
      expect((thrown as Error).message).not.toContain('postgres://')
      expect((thrown as Error).message).not.toContain('user:pass')
    }
  })

  it('throws GetOfferError when constructing the client itself fails for a well-formed id', async () => {
    const { getClient } = throwingClientFactory()
    await expect(getOfferById(getClient, '11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(GetOfferError)
  })
})
