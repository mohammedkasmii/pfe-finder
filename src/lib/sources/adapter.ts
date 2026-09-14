import type { CollectionResult } from '../ingestion/types'
import type { SourceConfig } from './registry'

/**
 * The adapter contract from docs/ARCHITECTURE.md: a configured source key
 * plus a `collect()` that fetches only allowlisted endpoints and returns
 * normalized candidates, completeness, and bounded metrics.
 *
 * `source` is the full configuration (not just its key) so the collector
 * orchestration (src/lib/collector/run.ts) can pass it to
 * `sanitizeCollectionResult`, which re-validates every candidate's
 * source/apply URL against `source.allowedHosts` — an adapter's own
 * `sourceKey` string alone is not enough to check that.
 */
export interface SourceAdapter {
  sourceKey: string
  source: SourceConfig
  collect(): Promise<CollectionResult>
}
