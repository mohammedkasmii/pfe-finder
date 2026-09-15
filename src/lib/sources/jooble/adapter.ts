import { boundedErrorSummary } from '../../ingestion/error-summary'
import type { CollectionResult, NormalizedCandidate } from '../../ingestion/types'
import type { SourceAdapter } from '../adapter'
import { fetchAllowlistedJson, type SchemaIssueSummary } from '../http-client'
import type { JoobleSourceConfig } from '../registry'
import { normalizeJoobleJob } from './normalize'
import { JoobleSearchResponseSchema, type JoobleJob } from './schema'

export interface JoobleAdapterOptions {
  source: JoobleSourceConfig
  fetchImpl?: typeof fetch
  /**
   * Test-only override so tests never need a real `JOOBLE_API_KEY`
   * environment variable. Production code always omits this — the key is
   * loaded lazily from `process.env` inside `collect()` (docs/SECURITY.md
   * M6A: "load the Jooble key only when the Jooble source actually
   * collects" — never at adapter-construction time, so a missing key
   * fails only this source, never `cli.ts`'s SmartRecruiters adapters).
   */
  apiKey?: string
}

const FETCH_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 2_000_000
const RESULTS_PER_PAGE = 50
const JOOBLE_HOST = 'ma.jooble.org'

// The one label every Jooble-related failure message uses — never the
// request URL, which carries the API key in its path (docs/SECURITY.md
// M6A's "special leakage risk": unlike a query string or `user:pass@`
// credential, `boundedErrorSummary`'s redaction patterns do not target a
// URL *path* segment, so the control here is architectural: the URL
// variable is simply never referenced by any string passed to an error
// constructor, log call, or `errorSummary` field anywhere in this file).
const ERROR_LABEL = 'Jooble API request failed'

/**
 * Appends safe, bounded schema-failure diagnostics (field path, Zod issue
 * code, and — only when available as a plain type name — the expected
 * type) to the constant error label. Never the response body, job
 * content, URL, or API key: `schemaIssues` (from `fetchAllowlistedJson`)
 * is already stripped down to that shape before it ever reaches this
 * function (docs/HANDOFF.md M6A production incident).
 */
function describeFailure(reason: string, schemaIssues: SchemaIssueSummary[] | undefined): string {
  if (!schemaIssues || schemaIssues.length === 0) return `${ERROR_LABEL}: ${reason}`
  const details = schemaIssues
    .map((issue) => (issue.expected ? `${issue.path}:${issue.code}(expected ${issue.expected})` : `${issue.path}:${issue.code}`))
    .join(', ')
  return `${ERROR_LABEL}: ${reason} [${details}]`
}

// Exactly two fixed searches per run (docs/SOURCES.md): no user-provided
// keywords, locations, hosts, or URLs are ever accepted, and no unlimited
// pagination is implemented — the free API key has a 500-request lifetime
// quota; two requests per daily collector run gives roughly 250 collection
// days (docs/HANDOFF.md M6A).
export const JOOBLE_FIXED_SEARCHES: ReadonlyArray<{ keywords: string; location: string }> = [
  { keywords: 'stage informatique', location: 'Maroc' },
  { keywords: 'PFE informatique', location: 'Maroc' },
]

function loadJoobleApiKey(): string | null {
  const key = process.env.JOOBLE_API_KEY
  const trimmed = key?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

/**
 * The Jooble implementation of the adapter contract (docs/ARCHITECTURE.md).
 * A scan is "complete" only when BOTH fixed searches succeed and their
 * schemas validate; a failure in either (network error, timeout, oversized
 * response, rejected redirect, or a `totalCount` exceeding what the
 * configured page size returned) marks the whole scan incomplete —
 * pagination is deliberately never implemented, to stay within the free
 * key's 500-request lifetime quota (docs/SOURCES.md).
 */
export function createJoobleAdapter(options: JoobleAdapterOptions): SourceAdapter {
  const fetchImpl = options.fetchImpl ?? fetch

  async function runSearch(search: { keywords: string; location: string }, apiKey: string) {
    // Built right before use and passed to nothing else in this file —
    // never logged, returned, or interpolated into any error/exception.
    const url = `https://${JOOBLE_HOST}/api/${apiKey}`
    const body = JSON.stringify({
      keywords: search.keywords,
      location: search.location,
      page: 1,
      ResultOnPage: RESULTS_PER_PAGE,
      companysearch: false,
    })

    return fetchAllowlistedJson(url, JoobleSearchResponseSchema, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      // Reject any redirect outright — the credential must never be
      // forwarded to another URL/host (docs/SECURITY.md M6A).
      maxRedirects: 0,
      allowedHosts: [JOOBLE_HOST],
      fetchImpl,
      method: 'POST',
      body,
    })
  }

  return {
    sourceKey: options.source.key,
    source: options.source,
    async collect(): Promise<CollectionResult> {
      const apiKey = options.apiKey ?? loadJoobleApiKey()
      if (!apiKey) {
        // A missing key fails only this source — cli.ts still runs every
        // SmartRecruiters adapter regardless (docs/SECURITY.md M6A).
        return {
          sourceKey: options.source.key,
          candidates: [],
          fetchedCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          scanComplete: false,
          errorSummary: boundedErrorSummary(`${ERROR_LABEL}: JOOBLE_API_KEY is not configured`),
        }
      }

      const discovered = new Map<string, JoobleJob>()
      let scanComplete = true
      let errorSummary: string | undefined

      for (const search of JOOBLE_FIXED_SEARCHES) {
        const result = await runSearch(search, apiKey)
        if (!result.ok) {
          scanComplete = false
          errorSummary = boundedErrorSummary(describeFailure(result.reason, result.schemaIssues))
          continue
        }

        for (const jobItem of result.data.jobs) {
          discovered.set(jobItem.id, jobItem)
        }

        if (result.data.totalCount > result.data.jobs.length) {
          // The fixed ResultOnPage quota doesn't exhaust every result for
          // this query; exhaustive pagination is disabled by design (the
          // free key's 500-request lifetime budget) — document as an
          // incomplete scan rather than silently claiming full coverage.
          scanComplete = false
          errorSummary = boundedErrorSummary(
            `${ERROR_LABEL}: totalCount exceeded the configured page size; exhaustive pagination is disabled by request-quota budget`,
          )
        }
      }

      const fetchedCount = discovered.size
      const candidates: NormalizedCandidate[] = []
      let acceptedCount = 0
      let rejectedCount = 0

      for (const jobItem of discovered.values()) {
        const candidate = normalizeJoobleJob(jobItem, options.source)
        if (candidate) {
          candidates.push(candidate)
          acceptedCount++
        } else {
          rejectedCount++
        }
      }

      return {
        sourceKey: options.source.key,
        candidates,
        fetchedCount,
        acceptedCount,
        rejectedCount,
        scanComplete,
        errorSummary,
      }
    },
  }
}
