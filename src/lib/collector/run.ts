import type { IngestionRepository } from '../db/repository'
import type { OfferRow } from '../db/types'
import { boundedErrorSummary } from '../ingestion/error-summary'
import type { NormalizedCandidate } from '../ingestion/types'
import { sanitizeCollectionResult } from '../ingestion/validate-collection-result'
import type { SourceAdapter } from '../sources/adapter'

export interface CollectorSummary {
  sourceKey: string
  status: 'succeeded' | 'failed' | 'skipped'
  scanComplete: boolean
  fetchedCount: number
  acceptedCount: number
  rejectedCount: number
  upsertedCount: number
  deactivatedCount: number
  errorSummary?: string
}

function candidateToOfferRow(candidate: NormalizedCandidate): OfferRow {
  return {
    source_key: candidate.sourceKey,
    external_id: candidate.externalId,
    source_url: candidate.sourceUrl,
    apply_url: candidate.applyUrl,
    canonical_url_hash: candidate.canonicalUrlHash,
    title: candidate.title,
    company: candidate.company,
    description_text: candidate.descriptionText,
    country: candidate.country,
    city: candidate.city,
    region: candidate.region,
    work_mode: candidate.workMode,
    internship_type: candidate.internshipType,
    is_pfe: candidate.isPfe,
    specialties: candidate.specialties,
    technologies: candidate.technologies,
    language: candidate.language,
    published_at: candidate.publishedAt,
  }
}

function skippedSummary(sourceKey: string): CollectorSummary {
  return {
    sourceKey,
    status: 'skipped',
    scanComplete: false,
    fetchedCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    upsertedCount: 0,
    deactivatedCount: 0,
  }
}

/**
 * Orchestrates one collection attempt per adapter: skip a disabled source
 * entirely (docs/SOURCES.md: "Disable a broken source only through a
 * reviewed configuration change"), otherwise fetch/normalize, validate the
 * adapter's raw result at the actual runtime boundary
 * (`sanitizeCollectionResult` — never trust an adapter's output shape or
 * candidate source keys), persist, and finalize atomically: a completed
 * scan deactivates missing offers and records source freshness in one
 * database call; a failed/partial scan records the error and source
 * freshness without touching any offer's active state
 * (docs/ARCHITECTURE.md: "A failed or partial scan never changes active
 * state.").
 */
export async function runCollector(deps: {
  repository: IngestionRepository
  adapters: SourceAdapter[]
}): Promise<CollectorSummary[]> {
  const summaries: CollectorSummary[] = []

  for (const adapter of deps.adapters) {
    const enabled = await deps.repository.isSourceEnabled(adapter.sourceKey)
    if (!enabled) {
      summaries.push(skippedSummary(adapter.sourceKey))
      continue
    }

    const runId = await deps.repository.startIngestionRun(adapter.sourceKey)
    try {
      const rawResult = await adapter.collect()
      const result = sanitizeCollectionResult(rawResult, adapter.source)

      const rows = result.candidates.map(candidateToOfferRow)
      const { upsertedCount, representedExternalIds } = await deps.repository.upsertOffers(rows)

      if (result.scanComplete) {
        const { deactivatedCount } = await deps.repository.finalizeCompletedRun({
          runId,
          sourceKey: adapter.sourceKey,
          // The exact IDs actually represented in storage after this
          // upsert — NOT result.candidates.map(c => c.externalId). A
          // candidate whose canonical URL collided with a different
          // existing external_id was never persisted under its own
          // external_id (see IngestionRepository's doc comment); reporting
          // it as "seen" anyway would leave the real, updated
          // representative row's sibling stale-duplicate never
          // deactivated.
          seenExternalIds: representedExternalIds,
          fetchedCount: result.fetchedCount,
          acceptedCount: result.acceptedCount,
          rejectedCount: result.rejectedCount,
          upsertedCount,
        })

        summaries.push({
          sourceKey: adapter.sourceKey,
          status: 'succeeded',
          scanComplete: true,
          fetchedCount: result.fetchedCount,
          acceptedCount: result.acceptedCount,
          rejectedCount: result.rejectedCount,
          upsertedCount,
          deactivatedCount,
        })
      } else {
        const sanitizedSummary = result.errorSummary ? boundedErrorSummary(result.errorSummary) : null
        await deps.repository.finalizeFailedRun({
          runId,
          sourceKey: adapter.sourceKey,
          errorCode: 'incomplete_scan',
          errorSummary: sanitizedSummary,
          fetchedCount: result.fetchedCount,
          acceptedCount: result.acceptedCount,
          rejectedCount: result.rejectedCount,
          upsertedCount,
        })

        summaries.push({
          sourceKey: adapter.sourceKey,
          status: 'failed',
          scanComplete: false,
          fetchedCount: result.fetchedCount,
          acceptedCount: result.acceptedCount,
          rejectedCount: result.rejectedCount,
          upsertedCount,
          deactivatedCount: 0,
          errorSummary: sanitizedSummary ?? undefined,
        })
      }
    } catch (error) {
      const sanitizedSummary = boundedErrorSummary(error instanceof Error ? error.message : 'unknown collector error')
      await deps.repository.finalizeFailedRun({
        runId,
        sourceKey: adapter.sourceKey,
        errorCode: 'collector_exception',
        errorSummary: sanitizedSummary,
        fetchedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        upsertedCount: 0,
      })

      summaries.push({
        sourceKey: adapter.sourceKey,
        status: 'failed',
        scanComplete: false,
        fetchedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        upsertedCount: 0,
        deactivatedCount: 0,
        errorSummary: sanitizedSummary,
      })
    }
  }

  return summaries
}
