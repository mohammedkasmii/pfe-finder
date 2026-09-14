import type { FinalizeCompletedRunParams, FinalizeFailedRunParams, OfferRow } from './types'

/**
 * Persistence boundary the collector orchestration (src/lib/collector/run.ts)
 * depends on. Two implementations exist: `createSupabaseIngestionRepository`
 * (real) for production, and `FakeIngestionRepository` (in-memory,
 * src/lib/collector/fake-repository.ts) so orchestration logic — idempotency,
 * enabled-source filtering, deactivate-only-on-complete-scan — is
 * unit-tested without a live database.
 *
 * `finalizeCompletedRun`/`finalizeFailedRun` each wrap a single atomic
 * SQL function call (see supabase/migrations/20260914010800_finalize_ingestion_run.sql)
 * rather than separate deactivate/update-freshness/finish-run steps, so
 * there is no window where a crash between steps could leave the run
 * "succeeded" but freshness or deactivation half-applied.
 *
 * `upsertOffers`'s `representedExternalIds` is deliberately NOT just
 * `rows.map(r => r.external_id)`: when a candidate's canonical URL
 * collides with a *different* external_id already holding that
 * canonical fingerprint for this source, the collision is resolved onto
 * the existing row (which receives the candidate's current data and
 * `last_seen_at`) rather than the candidate's own external_id, which is
 * never persisted this cycle. Callers (src/lib/collector/run.ts) MUST
 * pass only `representedExternalIds` — never the raw candidate list — to
 * `finalizeCompletedRun`'s `seenExternalIds`; otherwise the unpersisted
 * candidate's external_id would be counted as "seen" and its stale
 * pre-existing row (under its own external_id, holding the OLD canonical
 * hash) would never be deactivated.
 */
export interface IngestionRepository {
  isSourceEnabled(sourceKey: string): Promise<boolean>
  startIngestionRun(sourceKey: string): Promise<string>
  upsertOffers(rows: OfferRow[]): Promise<{ upsertedCount: number; representedExternalIds: string[] }>
  finalizeCompletedRun(params: FinalizeCompletedRunParams): Promise<{ deactivatedCount: number }>
  finalizeFailedRun(params: FinalizeFailedRunParams): Promise<void>
}
