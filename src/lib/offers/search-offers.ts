import type { SupabaseClient } from '@supabase/supabase-js'
import type { SpecialtySlug } from '../ingestion/dictionaries/specialties'
import type { WorkMode } from '../ingestion/classification'
import { verifyCursor, signCursor } from './cursor'
import { InvalidCursorError, SearchOffersError } from './errors'
import { toPublicOfferSummary, type OfferDbRow, type PublicOfferSummary } from './public-offer'
import type { OffersSort } from './query-schema'

const STALE_AFTER_MS = 48 * 60 * 60 * 1000

export interface SearchOffersParams {
  q?: string
  country?: 'MA' | 'FR'
  city?: string
  specialty?: SpecialtySlug
  technology?: string
  workMode?: WorkMode
  pfe?: true
  language?: 'fr' | 'en'
  sort: OffersSort
  cursor?: string
  limit: number
}

export interface Freshness {
  stale: boolean
  mostRecentSuccessAt: string | null
}

export interface SearchOffersResult {
  items: PublicOfferSummary[]
  nextCursor: string | null
  freshness: Freshness
}

function sortKeyOf(row: OfferDbRow, sort: OffersSort): string {
  if (sort === 'recently-seen') return row.last_seen_at
  return row.published_at ?? row.first_seen_at
}

/**
 * docs/SOURCES.md: "Show a stale-data notice when no enabled source has
 * succeeded within 48 hours." That's a per-source condition, not a
 * whole-result one — a single recently-successful source must never mask
 * a SIBLING enabled source that has never succeeded or has gone stale
 * (M3 review finding 6: the previous implementation took only the max of
 * non-null timestamps, so one healthy source hid every other failing
 * one). `stale` is true unless EVERY enabled source is both non-null and
 * within the window; `mostRecentSuccessAt` stays purely informational —
 * the latest known success across all enabled sources, reported
 * regardless of overall staleness.
 */
async function computeFreshness(client: SupabaseClient): Promise<Freshness> {
  const { data, error } = await client.from('sources').select('last_success_at').eq('enabled', true)
  if (error || !data || data.length === 0) {
    return { stale: true, mostRecentSuccessAt: null }
  }

  const rows = data as { last_success_at: string | null }[]
  let mostRecentSuccessAt: string | null = null
  let everySourceFresh = true

  for (const row of rows) {
    if (!row.last_success_at) {
      everySourceFresh = false
      continue
    }
    if (!mostRecentSuccessAt || row.last_success_at > mostRecentSuccessAt) {
      mostRecentSuccessAt = row.last_success_at
    }
    if (Date.now() - new Date(row.last_success_at).getTime() > STALE_AFTER_MS) {
      everySourceFresh = false
    }
  }

  return { stale: !everySourceFresh, mostRecentSuccessAt }
}

/**
 * The one function both `GET /api/offers` (src/app/api/offers/route.ts)
 * and the `/offers` server page call — no internal HTTP hop for the
 * page's first render. All filtering/sorting/pagination happens inside
 * the parameterized `search_offers` SQL function (Task 1); this layer
 * only signs/verifies the opaque cursor and maps rows to the public
 * field allowlist.
 */
export async function searchOffers(
  client: SupabaseClient,
  params: SearchOffersParams,
  secrets: { cursorSecret: string },
): Promise<SearchOffersResult> {
  let cursorValue: string | null = null
  let cursorId: string | null = null

  if (params.cursor) {
    const decoded = verifyCursor(params.cursor, secrets.cursorSecret)
    if (!decoded) {
      throw new InvalidCursorError()
    }
    // A verified cursor from a different sort is stale UI state (the user
    // changed the sort dropdown), not tampering — reset to page 1 rather
    // than erroring.
    if (decoded.sort === params.sort) {
      cursorValue = decoded.value
      cursorId = decoded.id
    }
  }

  const { data, error } = await client.rpc('search_offers', {
    p_query: params.q ?? null,
    p_country: params.country ?? null,
    p_city: params.city ?? null,
    p_specialty: params.specialty ?? null,
    p_technology: params.technology ?? null,
    p_work_mode: params.workMode ?? null,
    p_pfe: params.pfe ?? null,
    p_language: params.language ?? null,
    p_sort: params.sort,
    p_cursor_value: cursorValue,
    p_cursor_id: cursorId,
    p_limit: params.limit + 1,
  })
  if (error) {
    throw new SearchOffersError('failed to search offers', error)
  }

  const rows = (data ?? []) as OfferDbRow[]
  const hasMore = rows.length > params.limit
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows

  const lastRow = pageRows.at(-1)
  const nextCursor =
    hasMore && lastRow
      ? signCursor({ sort: params.sort, value: sortKeyOf(lastRow, params.sort), id: lastRow.id }, secrets.cursorSecret)
      : null

  const freshness = await computeFreshness(client)

  return {
    items: pageRows.map(toPublicOfferSummary),
    nextCursor,
    freshness,
  }
}
