import { boundedErrorSummary } from '../../ingestion/error-summary'
import type { CollectionResult, NormalizedCandidate } from '../../ingestion/types'
import type { SourceAdapter } from '../adapter'
import { fetchAllowlistedJson, withRetries } from '../http-client'
import type { SmartRecruitersSourceConfig } from '../registry'
import { normalizeSmartRecruitersPosting } from './normalize'
import {
  SmartRecruitersDetailResponseSchema,
  SmartRecruitersListingResponseSchema,
  type SmartRecruitersListingItem,
} from './schema'

export interface SmartRecruitersAdapterOptions {
  source: SmartRecruitersSourceConfig
  fetchImpl?: typeof fetch
  pageSize?: number
  maxPages?: number
}

const FETCH_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 2_000_000
const MAX_REDIRECTS = 3
const RETRY_OPTIONS = { maxRetries: 2, baseDelayMs: 300 }

function buildListingUrl(employerIdentifier: string, offset: number, limit: number, country: string): string {
  return `https://api.smartrecruiters.com/v1/companies/${employerIdentifier}/postings?offset=${offset}&limit=${limit}&country=${country.toLowerCase()}`
}

function buildDetailUrl(employerIdentifier: string, postingId: string): string {
  return `https://api.smartrecruiters.com/v1/companies/${employerIdentifier}/postings/${encodeURIComponent(postingId)}`
}

interface CountryListingOutcome {
  complete: boolean
  errorSummary?: string
}

/**
 * The SmartRecruiters implementation of the adapter contract
 * (docs/ARCHITECTURE.md). A scan is "complete" only when every listing
 * page and every posting detail either succeeded or was deterministically
 * rejected as invalid (docs/SOURCES.md) — a transient failure anywhere
 * marks the whole scan incomplete, which the collector (src/lib/collector/run.ts)
 * uses to decide whether it's safe to deactivate missing offers.
 *
 * Listings are fetched per the source's *configured* countries only
 * (`country=ma`/`country=fr`, traversed independently), never a global
 * unfiltered scan — docs/SOURCES.md restricts every source to Morocco and
 * France, and scanning the employer's entire global posting list would
 * both waste requests and risk pulling in postings outside that scope.
 * Posting IDs are deduplicated (a posting can appear in more than one
 * country's listing) before any detail request is made.
 */
export function createSmartRecruitersAdapter(options: SmartRecruitersAdapterOptions): SourceAdapter {
  const fetchImpl = options.fetchImpl ?? fetch
  const pageSize = options.pageSize ?? 100
  const maxPages = options.maxPages ?? 20

  async function collectCountryListingIds(
    country: string,
    discovered: Map<string, SmartRecruitersListingItem>,
  ): Promise<CountryListingOutcome> {
    let offset = 0
    for (let page = 0; page < maxPages; page++) {
      const listingResult = await withRetries(
        () =>
          fetchAllowlistedJson(
            buildListingUrl(options.source.employerIdentifier, offset, pageSize, country),
            SmartRecruitersListingResponseSchema,
            {
              timeoutMs: FETCH_TIMEOUT_MS,
              maxResponseBytes: MAX_RESPONSE_BYTES,
              maxRedirects: MAX_REDIRECTS,
              allowedHosts: options.source.allowedHosts,
              fetchImpl,
            },
          ),
        RETRY_OPTIONS,
      )

      if (!listingResult.ok) {
        return {
          complete: false,
          errorSummary: boundedErrorSummary(`listing fetch failed (country=${country}): ${listingResult.reason}`),
        }
      }

      for (const item of listingResult.data.content) {
        discovered.set(item.id, item)
      }

      offset += listingResult.data.content.length
      const reachedEnd = offset >= listingResult.data.totalFound || listingResult.data.content.length === 0
      if (reachedEnd) return { complete: true }
      if (page === maxPages - 1) {
        return {
          complete: false,
          errorSummary: boundedErrorSummary(
            `reached max page bound before exhausting listing (country=${country})`,
          ),
        }
      }
    }
    return { complete: true }
  }

  return {
    sourceKey: options.source.key,
    source: options.source,
    async collect(): Promise<CollectionResult> {
      const candidates: NormalizedCandidate[] = []
      let acceptedCount = 0
      let rejectedCount = 0
      let scanComplete = true
      let errorSummary: string | undefined

      // Deduplicated across every configured country before any detail
      // request is made.
      const discovered = new Map<string, SmartRecruitersListingItem>()

      for (const country of options.source.countries) {
        const outcome = await collectCountryListingIds(country, discovered)
        if (!outcome.complete) {
          scanComplete = false
          errorSummary = outcome.errorSummary
          // Keep trying the other configured countries — a failure in one
          // doesn't invalidate postings already found in another, and
          // scanComplete=false already prevents deactivating missing offers.
        }
      }

      const fetchedCount = discovered.size

      for (const item of discovered.values()) {
        const detailResult = await withRetries(
          () =>
            fetchAllowlistedJson(
              buildDetailUrl(options.source.employerIdentifier, item.id),
              SmartRecruitersDetailResponseSchema,
              {
                timeoutMs: FETCH_TIMEOUT_MS,
                maxResponseBytes: MAX_RESPONSE_BYTES,
                maxRedirects: MAX_REDIRECTS,
                allowedHosts: options.source.allowedHosts,
                fetchImpl,
              },
            ),
          RETRY_OPTIONS,
        )

        if (!detailResult.ok) {
          if (detailResult.kind === 'transient') {
            scanComplete = false
            errorSummary = boundedErrorSummary(`detail fetch failed for ${item.id}: ${detailResult.reason}`)
          } else {
            rejectedCount++
          }
          continue
        }

        const candidate = normalizeSmartRecruitersPosting(detailResult.data, options.source)
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
