import { describe, expect, it } from 'vitest'
import { IngestionDbError } from './errors'
import { createSupabaseIngestionRepository } from './supabase-repository'
import type { OfferRow } from './types'

type FakeResult = { data: unknown; error: unknown; count: number | null }

/**
 * A minimal fake mimicking just enough of supabase-js's chainable,
 * thenable PostgrestFilterBuilder surface for these tests: `.from()`/`.rpc()`
 * return a query object; every filter/option method returns `this` so
 * calls can chain in any order the real client allows; `.single()` and
 * `await`ing the builder directly (via `.then()`) both resolve to the
 * scripted result. Every call is recorded for assertions.
 */
class FakeQuery implements PromiseLike<FakeResult> {
  calls: Array<{ method: string; args: unknown[] }> = []
  private result: FakeResult

  constructor(result: FakeResult) {
    this.result = result
  }

  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args })
    return this
  }

  insert(...args: unknown[]) {
    return this.record('insert', args)
  }
  update(...args: unknown[]) {
    return this.record('update', args)
  }
  upsert(...args: unknown[]) {
    return this.record('upsert', args)
  }
  select(...args: unknown[]) {
    return this.record('select', args)
  }
  eq(...args: unknown[]) {
    return this.record('eq', args)
  }
  not(...args: unknown[]) {
    return this.record('not', args)
  }
  single() {
    this.record('single', [])
    return Promise.resolve(this.result)
  }
  maybeSingle() {
    this.record('maybeSingle', [])
    return Promise.resolve(this.result)
  }
  then<T1 = FakeResult, T2 = never>(
    onfulfilled?: (value: FakeResult) => T1 | PromiseLike<T1>,
    onrejected?: (reason: unknown) => T2 | PromiseLike<T2>,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected)
  }
}

/**
 * `scripted[key]` may be a single result (reused for every call) or an
 * array of results consumed in call order (repeating the last one once
 * exhausted) — needed because `upsertOffers`'s duplicate-fallback path
 * calls `.from('offers')` more than once with different intended outcomes
 * per call.
 */
function makeFakeClient(scripted: Record<string, FakeResult | FakeResult[]>) {
  const queries: Record<string, FakeQuery[]> = {}
  const callIndex: Record<string, number> = {}

  function nextResult(key: string): FakeResult {
    const entry = scripted[key] ?? { data: null, error: null, count: null }
    if (!Array.isArray(entry)) return entry
    const index = callIndex[key] ?? 0
    callIndex[key] = index + 1
    return entry[Math.min(index, entry.length - 1)]!
  }

  const client = {
    from(table: string) {
      const query = new FakeQuery(nextResult(table))
      queries[table] ??= []
      queries[table].push(query)
      return query
    },
    rpc(fnName: string, args: Record<string, unknown>) {
      const key = `rpc:${fnName}`
      const query = new FakeQuery(nextResult(key))
      query.calls.push({ method: 'rpc-args', args: [args] })
      const existing = queries[key] ?? []
      existing.push(query)
      queries[key] = existing
      return query
    },
  }
  return { client, queries }
}

const sampleRow: OfferRow = {
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
  published_at: null,
}

describe('createSupabaseIngestionRepository', () => {
  it('isSourceEnabled returns true when the row exists and enabled is true', async () => {
    const { client, queries } = makeFakeClient({
      sources: { data: { enabled: true }, error: null, count: null },
    })
    const repository = createSupabaseIngestionRepository(client as never)

    const enabled = await repository.isSourceEnabled('smartrecruiters-inetum')

    expect(enabled).toBe(true)
    const query = queries.sources![0]!
    expect(query.calls.some((c) => c.method === 'select' && c.args[0] === 'enabled')).toBe(true)
    expect(
      query.calls.some(
        (c) => c.method === 'eq' && c.args[0] === 'key' && c.args[1] === 'smartrecruiters-inetum',
      ),
    ).toBe(true)
  })

  it('isSourceEnabled returns false when the row exists and enabled is false', async () => {
    const { client } = makeFakeClient({
      sources: { data: { enabled: false }, error: null, count: null },
    })
    const repository = createSupabaseIngestionRepository(client as never)

    expect(await repository.isSourceEnabled('smartrecruiters-inetum')).toBe(false)
  })

  it('isSourceEnabled returns false when the source does not exist yet', async () => {
    const { client } = makeFakeClient({
      sources: { data: null, error: null, count: null },
    })
    const repository = createSupabaseIngestionRepository(client as never)

    expect(await repository.isSourceEnabled('unknown-source')).toBe(false)
  })

  it('isSourceEnabled throws IngestionDbError on failure', async () => {
    const { client } = makeFakeClient({
      sources: { data: null, error: { message: 'boom' }, count: null },
    })
    const repository = createSupabaseIngestionRepository(client as never)

    await expect(repository.isSourceEnabled('x')).rejects.toBeInstanceOf(IngestionDbError)
  })

  it('startIngestionRun inserts into ingestion_runs and returns the new id', async () => {
    const { client, queries } = makeFakeClient({
      ingestion_runs: { data: { id: 'run-1' }, error: null, count: null },
    })
    const repository = createSupabaseIngestionRepository(client as never)

    const runId = await repository.startIngestionRun('smartrecruiters-inetum')

    expect(runId).toBe('run-1')
    expect(queries.ingestion_runs![0]!.calls[0]).toEqual({
      method: 'insert',
      args: [{ source_key: 'smartrecruiters-inetum', status: 'running' }],
    })
  })

  it('startIngestionRun throws IngestionDbError, never the raw Postgres error, on failure', async () => {
    const { client } = makeFakeClient({
      ingestion_runs: { data: null, error: { message: 'connection string leaked here' }, count: null },
    })
    const repository = createSupabaseIngestionRepository(client as never)

    await expect(repository.startIngestionRun('x')).rejects.toBeInstanceOf(IngestionDbError)
    await expect(repository.startIngestionRun('x')).rejects.not.toThrow(/connection string/)
  })

  it('upsertOffers never includes first_seen_at or created_at in the payload', async () => {
    const { client, queries } = makeFakeClient({
      offers: { data: null, error: null, count: 1 },
    })
    const repository = createSupabaseIngestionRepository(client as never)

    await repository.upsertOffers([sampleRow])

    const upsertCall = queries.offers![0]!.calls.find((c) => c.method === 'upsert')
    const payloadRows = upsertCall?.args[0] as Record<string, unknown>[]
    expect(payloadRows[0]).not.toHaveProperty('first_seen_at')
    expect(payloadRows[0]).not.toHaveProperty('created_at')
    expect(payloadRows[0]).toMatchObject({ status: 'active', inactive_at: null, source_key: sampleRow.source_key })
    expect(upsertCall?.args[1]).toMatchObject({ onConflict: 'source_key,external_id' })
  })

  it('upsertOffers returns every row\'s own external_id as represented when the batch succeeds with no collision', async () => {
    const otherRow: OfferRow = { ...sampleRow, external_id: 'xyz789', canonical_url_hash: 'other-hash' }
    const { client } = makeFakeClient({
      offers: { data: null, error: null, count: 2 },
    })
    const repository = createSupabaseIngestionRepository(client as never)

    const result = await repository.upsertOffers([sampleRow, otherRow])

    expect(result).toEqual({ upsertedCount: 2, representedExternalIds: ['abc123', 'xyz789'] })
  })

  it('upsertOffers returns upsertedCount 0 and representedExternalIds [] and never calls the client for an empty batch', async () => {
    const { client, queries } = makeFakeClient({})
    const repository = createSupabaseIngestionRepository(client as never)

    const result = await repository.upsertOffers([])

    expect(result).toEqual({ upsertedCount: 0, representedExternalIds: [] })
    expect(queries.offers).toBeUndefined()
  })

  it('upsertOffers throws IngestionDbError on a non-unique-violation failure', async () => {
    const { client } = makeFakeClient({
      offers: { data: null, error: { message: 'boom', code: '08006' }, count: null },
    })
    const repository = createSupabaseIngestionRepository(client as never)

    await expect(repository.upsertOffers([sampleRow])).rejects.toBeInstanceOf(IngestionDbError)
  })

  it('upsertOffers falls back to per-row upserts on a canonical-fingerprint unique violation, updating the EXISTING representative row rather than skipping', async () => {
    const otherRow: OfferRow = { ...sampleRow, external_id: 'xyz789', canonical_url_hash: 'other-hash' }
    const { client, queries } = makeFakeClient({
      offers: [
        // Batched attempt: hits the secondary unique constraint.
        { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' }, count: null },
        // Per-row retry #1 succeeds outright (no collision for this row).
        { data: null, error: null, count: 1 },
        // Per-row retry #2 collides: canonical_url_hash already belongs to
        // a different existing external_id ('existing-xyz').
        { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' }, count: null },
        // The lookup for the existing row holding that canonical hash.
        { data: { external_id: 'existing-xyz' }, error: null, count: null },
        // The update applied to that existing row.
        { data: null, error: null, count: 1 },
      ],
    })
    const repository = createSupabaseIngestionRepository(client as never)

    const result = await repository.upsertOffers([sampleRow, otherRow])

    expect(result).toEqual({ upsertedCount: 2, representedExternalIds: ['abc123', 'existing-xyz'] })
    // One batched attempt + two per-row retries + one lookup + one update.
    expect(queries.offers).toHaveLength(5)
    const updateCall = queries.offers![4]!.calls.find((c) => c.method === 'update')
    const updatePayload = updateCall?.args[0] as Record<string, unknown>
    // The existing row's own identity columns must never be overwritten
    // with the colliding candidate's.
    expect(updatePayload).not.toHaveProperty('external_id')
    expect(updatePayload).not.toHaveProperty('source_key')
    expect(updatePayload).not.toHaveProperty('canonical_url_hash')
    expect(updatePayload).toMatchObject({ title: otherRow.title, status: 'active', inactive_at: null })
  })

  it('upsertOffers skips (does not fabricate an identity for) a collision whose existing row disappeared before the lookup', async () => {
    const { client, queries } = makeFakeClient({
      offers: [
        // Initial batched attempt fails.
        { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' }, count: null },
        // Per-row retry also collides.
        { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' }, count: null },
        // Lookup finds nothing — race condition.
        { data: null, error: null, count: null },
      ],
    })
    const repository = createSupabaseIngestionRepository(client as never)

    const result = await repository.upsertOffers([sampleRow])

    expect(result).toEqual({ upsertedCount: 0, representedExternalIds: [] })
    expect(queries.offers).toHaveLength(3)
  })

  it('finalizeCompletedRun calls the finalize_completed_run RPC with the expected parameters', async () => {
    const { client, queries } = makeFakeClient({
      'rpc:finalize_completed_run': { data: 3, error: null, count: null },
    })
    const repository = createSupabaseIngestionRepository(client as never)

    const result = await repository.finalizeCompletedRun({
      runId: 'run-1',
      sourceKey: 'smartrecruiters-inetum',
      seenExternalIds: ['a', 'b'],
      fetchedCount: 2,
      acceptedCount: 2,
      rejectedCount: 0,
      upsertedCount: 2,
    })

    expect(result).toEqual({ deactivatedCount: 3 })
    const rpcCall = queries['rpc:finalize_completed_run']![0]!.calls.find((c) => c.method === 'rpc-args')
    expect(rpcCall?.args[0]).toEqual({
      p_run_id: 'run-1',
      p_source_key: 'smartrecruiters-inetum',
      p_seen_external_ids: ['a', 'b'],
      p_fetched_count: 2,
      p_accepted_count: 2,
      p_rejected_count: 0,
      p_upserted_count: 2,
    })
  })

  it('finalizeCompletedRun throws IngestionDbError on failure', async () => {
    const { client } = makeFakeClient({
      'rpc:finalize_completed_run': { data: null, error: { message: 'boom' }, count: null },
    })
    const repository = createSupabaseIngestionRepository(client as never)

    await expect(
      repository.finalizeCompletedRun({
        runId: 'run-1',
        sourceKey: 'x',
        seenExternalIds: [],
        fetchedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        upsertedCount: 0,
      }),
    ).rejects.toBeInstanceOf(IngestionDbError)
  })

  it('finalizeFailedRun calls the finalize_failed_run RPC with the expected parameters', async () => {
    const { client, queries } = makeFakeClient({
      'rpc:finalize_failed_run': { data: null, error: null, count: null },
    })
    const repository = createSupabaseIngestionRepository(client as never)

    await repository.finalizeFailedRun({
      runId: 'run-1',
      sourceKey: 'smartrecruiters-inetum',
      errorCode: 'incomplete_scan',
      errorSummary: 'listing fetch failed: timeout',
      fetchedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      upsertedCount: 0,
    })

    const rpcCall = queries['rpc:finalize_failed_run']![0]!.calls.find((c) => c.method === 'rpc-args')
    expect(rpcCall?.args[0]).toEqual({
      p_run_id: 'run-1',
      p_source_key: 'smartrecruiters-inetum',
      p_error_code: 'incomplete_scan',
      p_error_summary: 'listing fetch failed: timeout',
      p_fetched_count: 0,
      p_accepted_count: 0,
      p_rejected_count: 0,
      p_upserted_count: 0,
    })
  })

  it('finalizeFailedRun throws IngestionDbError on failure', async () => {
    const { client } = makeFakeClient({
      'rpc:finalize_failed_run': { data: null, error: { message: 'boom' }, count: null },
    })
    const repository = createSupabaseIngestionRepository(client as never)

    await expect(
      repository.finalizeFailedRun({
        runId: 'run-1',
        sourceKey: 'x',
        errorCode: 'collector_exception',
        errorSummary: null,
        fetchedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        upsertedCount: 0,
      }),
    ).rejects.toBeInstanceOf(IngestionDbError)
  })
})
