import type { SourceConfig } from '../sources/registry'
import { CollectionResultSchema, NormalizedCandidateSchema, type CollectionResult, type NormalizedCandidate } from './types'
import { computeCanonicalUrlHash, validateAllowlistedHttpsUrl } from './urls'

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

/**
 * Re-checks a single already-schema-valid candidate against the actual
 * source it claims to belong to. `NormalizedCandidateSchema` only checks
 * shape/bounds (`z.url()` accepts `https://evil.example` just as happily
 * as an allowlisted host, and `canonicalUrlHash` is only `min(1)`) — this
 * is the check that a compromised or buggy adapter can't forge a URL
 * outside the source's approved hosts or an arbitrary canonical
 * fingerprint that doesn't actually correspond to the offer's own URL
 * (which would silently defeat canonical-duplicate detection).
 */
function isGenuineForSource(candidate: NormalizedCandidate, source: SourceConfig): boolean {
  const sourceUrlCheck = validateAllowlistedHttpsUrl(candidate.sourceUrl, source.allowedHosts)
  if (!sourceUrlCheck.ok) return false
  const applyUrlCheck = validateAllowlistedHttpsUrl(candidate.applyUrl, source.allowedHosts)
  if (!applyUrlCheck.ok) return false
  if (!SHA256_HEX_PATTERN.test(candidate.canonicalUrlHash)) return false
  return candidate.canonicalUrlHash === computeCanonicalUrlHash(sourceUrlCheck.url)
}

/**
 * The actual runtime boundary between an untrusted adapter's raw result
 * and persistence: a bug in an adapter (or, defensively, a compromised
 * one) must never crash the whole collector run, corrupt another
 * source's data, or silently pass through malformed data. This function
 * never throws.
 *
 * - The top-level shape is validated against `CollectionResultSchema`; a
 *   malformed shape becomes a safe, empty, incomplete-scan result rather
 *   than propagating garbage.
 * - Every candidate is re-validated against `NormalizedCandidateSchema`
 *   individually, so one malformed candidate is dropped (counted as
 *   rejected) without invalidating the rest of the batch.
 * - Every candidate's `sourceKey` must match `expectedSource.key` — the
 *   adapter actually being run — so a bug that mislabels a candidate (or
 *   a malicious/compromised adapter) can never attribute an offer to a
 *   different source.
 * - Every candidate's source/apply URL must be HTTPS on one of
 *   `expectedSource.allowedHosts`, and its `canonicalUrlHash` must be a
 *   lowercase 64-character SHA-256 hex digest that actually matches the
 *   candidate's own (normalized) source URL — the full `SourceConfig` is
 *   required (not just the key) specifically so this check can run here,
 *   at the real trust boundary, rather than trusting the adapter to have
 *   done it correctly.
 */
export function sanitizeCollectionResult(raw: unknown, expectedSource: SourceConfig): CollectionResult {
  const expectedSourceKey = expectedSource.key
  const topLevel = CollectionResultSchema.safeParse(raw)
  if (!topLevel.success) {
    return {
      sourceKey: expectedSourceKey,
      candidates: [],
      fetchedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      scanComplete: false,
      errorSummary: 'adapter returned a malformed collection result',
    }
  }

  const validCandidates: NormalizedCandidate[] = []
  let droppedCount = 0

  for (const candidate of topLevel.data.candidates) {
    const parsed = NormalizedCandidateSchema.safeParse(candidate)
    if (parsed.success && parsed.data.sourceKey === expectedSourceKey && isGenuineForSource(parsed.data, expectedSource)) {
      validCandidates.push(parsed.data)
    } else {
      droppedCount++
    }
  }

  return {
    // Never trust the raw sourceKey — always stamp the one the caller
    // knows it's actually running.
    sourceKey: expectedSourceKey,
    candidates: validCandidates,
    fetchedCount: topLevel.data.fetchedCount,
    acceptedCount: validCandidates.length,
    rejectedCount: topLevel.data.rejectedCount + droppedCount,
    scanComplete: topLevel.data.scanComplete,
    errorSummary: topLevel.data.errorSummary,
  }
}
