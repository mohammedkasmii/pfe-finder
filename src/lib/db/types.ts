/**
 * Row shape written to the `offers` table by the ingestion collector.
 * Deliberately excludes `id`, `first_seen_at`, `created_at`, and
 * `updated_at` — the database manages all four (see the migrations and
 * `supabase-repository.ts`'s comment on why omitting `first_seen_at` from
 * every upsert payload is what makes repeated imports idempotent).
 */
export interface OfferRow {
  source_key: string
  external_id: string
  source_url: string
  apply_url: string
  canonical_url_hash: string
  title: string
  company: string
  description_text: string
  country: 'MA' | 'FR'
  city: string | null
  region: string | null
  work_mode: 'onsite' | 'hybrid' | 'remote' | 'unknown'
  internship_type: 'internship'
  is_pfe: boolean
  specialties: string[]
  technologies: string[]
  language: 'fr' | 'en'
  published_at: string | null
}

export type IngestionRunStatus = 'running' | 'succeeded' | 'failed'

/**
 * Parameters for the `finalize_completed_run` SQL function
 * (supabase/migrations/20260914010800_finalize_ingestion_run.sql):
 * atomically deactivates offers missing from the scan, records
 * `sources.last_success_at`, and finishes the run as `succeeded`.
 */
export interface FinalizeCompletedRunParams {
  runId: string
  sourceKey: string
  seenExternalIds: string[]
  fetchedCount: number
  acceptedCount: number
  rejectedCount: number
  upsertedCount: number
}

/**
 * Parameters for the `finalize_failed_run` SQL function: records
 * `sources.last_error_at` (without touching `last_success_at`) and
 * finishes the run as `failed`, never deactivating any offer.
 */
export interface FinalizeFailedRunParams {
  runId: string
  sourceKey: string
  errorCode: string
  errorSummary: string | null
  fetchedCount: number
  acceptedCount: number
  rejectedCount: number
  upsertedCount: number
}
