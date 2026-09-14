import type { IngestionRepository } from '../db/repository'
import type { FinalizeCompletedRunParams, FinalizeFailedRunParams, IngestionRunStatus, OfferRow } from '../db/types'

interface StoredOffer extends OfferRow {
  status: 'active' | 'inactive'
  first_seen_at: string
  last_seen_at: string
  inactive_at: string | null
}

interface StoredRun {
  source_key: string
  started_at: string
  status: IngestionRunStatus
  scan_complete: boolean
  fetched_count?: number
  accepted_count?: number
  rejected_count?: number
  upserted_count?: number
  deactivated_count?: number
  error_code?: string | null
  error_summary?: string | null
}

interface StoredSource {
  last_success_at: string | null
  last_error_at: string | null
}

/**
 * In-memory double for IngestionRepository. Exists purely to test
 * src/lib/collector/run.ts's orchestration logic (idempotency, enabled-
 * source filtering, deactivate-only-on-complete-scan) without a live
 * Postgres connection. Test-only — never imported by app or collector
 * runtime code — but kept as a real module (not inlined per test file) so
 * its upsert-by-unique-key semantics are written and reviewed once.
 *
 * `isSourceEnabled` defaults to `true` for any key not explicitly
 * disabled via `disableSource` — this sidesteps needing a closed universe
 * of known source keys (unlike the real implementation, which queries a
 * concrete `sources` row), so existing tests need no source-seeding setup
 * to keep working.
 */
export class FakeIngestionRepository implements IngestionRepository {
  offers = new Map<string, StoredOffer>() // key: `${source_key}:${external_id}`
  runs = new Map<string, StoredRun>()
  sources = new Map<string, StoredSource>()
  private disabledSourceKeys = new Set<string>()
  private nextRunId = 1

  disableSource(sourceKey: string): void {
    this.disabledSourceKeys.add(sourceKey)
  }

  async isSourceEnabled(sourceKey: string): Promise<boolean> {
    return !this.disabledSourceKeys.has(sourceKey)
  }

  async startIngestionRun(sourceKey: string): Promise<string> {
    const id = `run-${this.nextRunId++}`
    this.runs.set(id, {
      source_key: sourceKey,
      started_at: new Date().toISOString(),
      status: 'running',
      scan_complete: false,
    })
    return id
  }

  async upsertOffers(rows: OfferRow[]): Promise<{ upsertedCount: number; representedExternalIds: string[] }> {
    const nowIso = new Date().toISOString()
    const representedExternalIds: string[] = []
    for (const row of rows) {
      const key = `${row.source_key}:${row.external_id}`
      const existing = this.offers.get(key)

      // Mirrors the real Postgres unique constraint on
      // (source_key, canonical_url_hash): if a DIFFERENT external_id for
      // this source already holds this canonical fingerprint, that row —
      // not the candidate's own external_id's row, even if one already
      // exists — is the representation that receives this candidate's
      // current data. Checked unconditionally (not only when `!existing`):
      // an existing row whose URL now normalizes to a hash a DIFFERENT
      // row already holds must collide too, exactly as a real batched
      // upsert changing that row's canonical_url_hash would.
      const collision = [...this.offers.entries()].find(
        ([k, offer]) =>
          k !== key && offer.source_key === row.source_key && offer.canonical_url_hash === row.canonical_url_hash,
      )
      if (collision) {
        const [collisionKey, collisionOffer] = collision
        this.offers.set(collisionKey, {
          ...row,
          source_key: collisionOffer.source_key,
          external_id: collisionOffer.external_id,
          canonical_url_hash: collisionOffer.canonical_url_hash,
          status: 'active',
          inactive_at: null,
          first_seen_at: collisionOffer.first_seen_at,
          last_seen_at: nowIso,
        })
        representedExternalIds.push(collisionOffer.external_id)
        continue
      }

      this.offers.set(key, {
        ...row,
        status: 'active',
        inactive_at: null,
        first_seen_at: existing?.first_seen_at ?? nowIso,
        last_seen_at: nowIso,
      })
      representedExternalIds.push(row.external_id)
    }
    return { upsertedCount: rows.length, representedExternalIds }
  }

  async finalizeCompletedRun(params: FinalizeCompletedRunParams): Promise<{ deactivatedCount: number }> {
    const seen = new Set(params.seenExternalIds)
    const nowIso = new Date().toISOString()
    let deactivatedCount = 0
    for (const [key, offer] of this.offers) {
      if (offer.source_key !== params.sourceKey || offer.status !== 'active') continue
      if (seen.has(offer.external_id)) continue
      this.offers.set(key, { ...offer, status: 'inactive', inactive_at: nowIso })
      deactivatedCount++
    }

    const existingSource = this.sources.get(params.sourceKey) ?? { last_success_at: null, last_error_at: null }
    this.sources.set(params.sourceKey, { ...existingSource, last_success_at: nowIso })

    const run = this.runs.get(params.runId)
    if (run) {
      this.runs.set(params.runId, {
        ...run,
        status: 'succeeded',
        scan_complete: true,
        fetched_count: params.fetchedCount,
        accepted_count: params.acceptedCount,
        rejected_count: params.rejectedCount,
        upserted_count: params.upsertedCount,
        deactivated_count: deactivatedCount,
        error_code: null,
        error_summary: null,
      })
    }

    return { deactivatedCount }
  }

  async finalizeFailedRun(params: FinalizeFailedRunParams): Promise<void> {
    const nowIso = new Date().toISOString()

    const existingSource = this.sources.get(params.sourceKey) ?? { last_success_at: null, last_error_at: null }
    this.sources.set(params.sourceKey, { ...existingSource, last_error_at: nowIso })

    const run = this.runs.get(params.runId)
    if (run) {
      this.runs.set(params.runId, {
        ...run,
        status: 'failed',
        scan_complete: false,
        fetched_count: params.fetchedCount,
        accepted_count: params.acceptedCount,
        rejected_count: params.rejectedCount,
        upserted_count: params.upsertedCount,
        deactivated_count: 0,
        error_code: params.errorCode,
        error_summary: params.errorSummary,
      })
    }
  }
}
