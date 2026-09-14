import type { SupabaseClient } from '@supabase/supabase-js'
import { IngestionDbError } from './errors'
import type { IngestionRepository } from './repository'
import type { FinalizeCompletedRunParams, FinalizeFailedRunParams, OfferRow } from './types'

// Postgres SQLSTATE for a unique-constraint violation.
const UNIQUE_VIOLATION = '23505'

export function createSupabaseIngestionRepository(client: SupabaseClient): IngestionRepository {
  return {
    async isSourceEnabled(sourceKey) {
      const { data, error } = await client
        .from('sources')
        .select('enabled')
        .eq('key', sourceKey)
        .maybeSingle()
      if (error) throw new IngestionDbError('failed to check source enabled state', error)
      // A source not yet present in the database (e.g. before its seed
      // migration ran) is not safe to collect for.
      return data?.enabled ?? false
    },

    async startIngestionRun(sourceKey) {
      const { data, error } = await client
        .from('ingestion_runs')
        .insert({ source_key: sourceKey, status: 'running' })
        .select('id')
        .single()
      if (error || !data) throw new IngestionDbError('failed to start ingestion run', error)
      return data.id as string
    },

    async upsertOffers(rows: OfferRow[]) {
      if (rows.length === 0) return { upsertedCount: 0, representedExternalIds: [] }
      const nowIso = new Date().toISOString()
      // Deliberately omit first_seen_at/created_at from every row: Postgres
      // fills them via column DEFAULT now() on INSERT, and PostgREST's
      // merge-duplicates upsert only SETs columns present in the payload
      // (confirmed against PostgREST's docs), so an existing row's
      // first_seen_at/created_at is never touched on conflict. This is
      // what makes "retry creates no duplicates and never resets
      // first_seen_at" true without any extra application logic.
      const preparedRows = rows.map((row) => ({
        ...row,
        status: 'active' as const,
        inactive_at: null,
        last_seen_at: nowIso,
      }))

      const { error, count } = await client
        .from('offers')
        .upsert(preparedRows, { onConflict: 'source_key,external_id', count: 'exact' })
      if (!error) {
        // No collision: every row's own external_id is the persisted
        // representation.
        return { upsertedCount: count ?? preparedRows.length, representedExternalIds: rows.map((r) => r.external_id) }
      }
      if (error.code !== UNIQUE_VIOLATION) throw new IngestionDbError('failed to upsert offers', error)

      // The batch hit the secondary `(source_key, canonical_url_hash)`
      // constraint: some candidate's canonical URL is already claimed by a
      // different external_id for this source. `ON CONFLICT` only catches
      // conflicts on the target we named (source_key, external_id), so a
      // violation of the OTHER unique constraint aborts the whole batched
      // statement. Fall back to per-row upserts so one colliding candidate
      // can't sink the rest of the batch.
      let upsertedCount = 0
      const representedExternalIds: string[] = []
      for (const row of preparedRows) {
        const { error: rowError } = await client
          .from('offers')
          .upsert([row], { onConflict: 'source_key,external_id' })
        if (!rowError) {
          upsertedCount++
          representedExternalIds.push(row.external_id)
          continue
        }
        if (rowError.code !== UNIQUE_VIOLATION) {
          throw new IngestionDbError('failed to upsert offers', rowError)
        }

        // Canonical-fingerprint duplicate of another external_id for this
        // source. Do NOT just skip it: the existing row already holding
        // this canonical_url_hash is the row that actually represents
        // this posting going forward, so it must receive the incoming
        // candidate's current data and last_seen_at — and ITS external_id
        // (not the colliding candidate's, which was never persisted) is
        // what the caller must report as "seen" to finalization. Skipping
        // silently here while still reporting the candidate's own
        // external_id as seen (the old bug) left the existing row's stale
        // data untouched and never deactivated it.
        const { data: existing, error: lookupError } = await client
          .from('offers')
          .select('external_id')
          .eq('source_key', row.source_key)
          .eq('canonical_url_hash', row.canonical_url_hash)
          .maybeSingle()
        if (lookupError) throw new IngestionDbError('failed to look up canonical-fingerprint collision', lookupError)
        if (!existing) {
          // Race condition: the colliding row disappeared between the
          // failed upsert and this lookup. Nothing to represent this
          // cycle — do not fabricate an identity.
          continue
        }

        // Update the EXISTING row (its own external_id/canonical_url_hash
        // untouched — (source_key, external_id) stays the only identity we
        // ever change rows for) with the incoming candidate's current
        // data. The colliding candidate's own external_id is intentionally
        // never persisted or reported as represented.
        const updateFields: Partial<OfferRow> = { ...row }
        delete updateFields.external_id
        delete updateFields.source_key
        delete updateFields.canonical_url_hash

        const { error: updateError } = await client
          .from('offers')
          .update(updateFields)
          .eq('source_key', row.source_key)
          .eq('external_id', existing.external_id as string)
        if (updateError) throw new IngestionDbError('failed to update canonical collision representative', updateError)
        upsertedCount++
        representedExternalIds.push(existing.external_id as string)
      }
      return { upsertedCount, representedExternalIds }
    },

    async finalizeCompletedRun(params: FinalizeCompletedRunParams) {
      // No `.single()` here: `finalize_completed_run` is a scalar-returning
      // function (`returns integer`). PostgREST's documented behavior for
      // scalar functions is to respond with the bare value directly (e.g.
      // the JSON body `3`), not a table-valued JSON array of rows — `.single()`
      // is for unwrapping the latter and doesn't apply here.
      const { data, error } = await client.rpc('finalize_completed_run', {
        p_run_id: params.runId,
        p_source_key: params.sourceKey,
        p_seen_external_ids: params.seenExternalIds,
        p_fetched_count: params.fetchedCount,
        p_accepted_count: params.acceptedCount,
        p_rejected_count: params.rejectedCount,
        p_upserted_count: params.upsertedCount,
      })
      if (error) throw new IngestionDbError('failed to finalize completed run', error)
      return { deactivatedCount: (data as number) ?? 0 }
    },

    async finalizeFailedRun(params: FinalizeFailedRunParams) {
      const { error } = await client.rpc('finalize_failed_run', {
        p_run_id: params.runId,
        p_source_key: params.sourceKey,
        p_error_code: params.errorCode,
        p_error_summary: params.errorSummary,
        p_fetched_count: params.fetchedCount,
        p_accepted_count: params.acceptedCount,
        p_rejected_count: params.rejectedCount,
        p_upserted_count: params.upsertedCount,
      })
      if (error) throw new IngestionDbError('failed to finalize failed run', error)
    },
  }
}
