'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFavorites } from '@/lib/favorites/use-favorites'
import type { Locale } from '@/lib/i18n/config'
import type { Dictionary } from '@/lib/i18n/types'
import type { OffersQuery } from '@/lib/offers/query-schema'
import type { PublicOfferSummary } from '@/lib/offers/public-offer'
import type { Freshness, SearchOffersResult } from '@/lib/offers/search-offers'
import { FiltersPanel, type FiltersValue } from './filters-panel'
import { FreshnessBanner } from './freshness-banner'
import { OfferCard } from './offer-card'

interface OffersSearchExperienceProps {
  initialQuery: OffersQuery
  initialResult: SearchOffersResult
  ignoredKeys: string[]
  dictionary: Dictionary
  locale: Locale
}

const DEBOUNCE_MS = 300

function toFiltersValue(query: OffersQuery): FiltersValue {
  return {
    q: query.q ?? '',
    country: query.country ?? '',
    city: query.city ?? '',
    specialty: query.specialty ?? '',
    technology: query.technology ?? '',
    workMode: query.workMode ?? '',
    pfe: query.pfe ?? false,
    language: query.language ?? '',
    sort: query.sort,
  }
}

function buildSearchParams(filters: FiltersValue, cursor?: string | null): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.country) params.set('country', filters.country)
  if (filters.city) params.set('city', filters.city)
  if (filters.specialty) params.set('specialty', filters.specialty)
  if (filters.technology) params.set('technology', filters.technology)
  if (filters.workMode) params.set('workMode', filters.workMode)
  if (filters.pfe) params.set('pfe', 'true')
  if (filters.language) params.set('language', filters.language)
  if (filters.sort !== 'newest') params.set('sort', filters.sort)
  if (cursor) params.set('cursor', cursor)
  return params
}

type Status = 'idle' | 'loading' | 'loadingMore' | 'error'

export function OffersSearchExperience({
  initialQuery,
  initialResult,
  ignoredKeys,
  dictionary,
  locale,
}: OffersSearchExperienceProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { isFavorite, toggleFavorite } = useFavorites()

  const [filters, setFiltersState] = useState<FiltersValue>(() => toFiltersValue(initialQuery))
  const [items, setItems] = useState<PublicOfferSummary[]>(initialResult.items)
  const [nextCursor, setNextCursor] = useState<string | null>(initialResult.nextCursor)
  const [freshness, setFreshness] = useState<Freshness>(initialResult.freshness)
  const [status, setStatus] = useState<Status>('idle')
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
  const [liveMessage, setLiveMessage] = useState('')
  const [showIgnoredNotice, setShowIgnoredNotice] = useState(ignoredKeys.length > 0)

  // Skip the debounced fetch on mount — the server already provided
  // initialResult for the current filters.
  const isFirstRender = useRef(true)

  // M3 review finding 7: debouncing only delays STARTING a request; it
  // does nothing to stop an older request's response from committing
  // after a newer one if the network resolves them out of order. Two
  // independent guards: (1) abort the previous REPLACE request's fetch
  // outright when a new one starts, and (2) a monotonically increasing
  // request id so that even if a mock/browser doesn't honor the abort
  // signal, a response can never commit unless it's still the most
  // recent request issued.
  const latestRequestIdRef = useRef(0)
  const replaceAbortControllerRef = useRef<AbortController | null>(null)

  const fetchPage = useCallback(
    async (nextFilters: FiltersValue, cursor: string | null, mode: 'replace' | 'append') => {
      if (mode === 'replace') {
        replaceAbortControllerRef.current?.abort()
      }
      const controller = new AbortController()
      if (mode === 'replace') replaceAbortControllerRef.current = controller
      const requestId = ++latestRequestIdRef.current
      const isStillCurrent = () => requestId === latestRequestIdRef.current

      setStatus(mode === 'append' ? 'loadingMore' : 'loading')
      setLoadMoreFailed(false)
      setLiveMessage(mode === 'append' ? dictionary.offers.pagination.loadingMore : dictionary.offers.states.loading)
      try {
        const params = buildSearchParams(nextFilters, cursor)
        const response = await fetch(`/api/offers?${params.toString()}`, { signal: controller.signal })
        if (!response.ok) throw new Error('request failed')
        const data = (await response.json()) as SearchOffersResult
        if (!isStillCurrent()) return // superseded by a newer request — never commit

        setItems((current) => {
          const next = mode === 'append' ? [...current, ...data.items] : data.items
          // Computed from the updater's own `next`, never the outer
          // closure's `items` — that value would be stale across renders
          // since `fetchPage` intentionally isn't recreated on every
          // items change (see the deps array below).
          setLiveMessage(dictionary.offers.states.resultsCount.replace('{count}', String(next.length)))
          return next
        })
        setNextCursor(data.nextCursor)
        setFreshness(data.freshness)
        setStatus('idle')
      } catch (thrown) {
        // An aborted request (superseded by a newer one) resolves via
        // rejection too — silently ignore it, the newer request already
        // owns the UI state.
        if (thrown instanceof DOMException && thrown.name === 'AbortError') return
        if (!isStillCurrent()) return

        if (mode === 'append') {
          // Keep whatever is already loaded visible — only a fresh
          // (replace) failure has nothing meaningful to show instead.
          setStatus('idle')
          setLoadMoreFailed(true)
          setLiveMessage(dictionary.offers.states.error)
        } else {
          setStatus('error')
          setLiveMessage(dictionary.offers.states.error)
        }
      }
    },
    [dictionary],
  )

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const timeout = setTimeout(() => {
      const params = buildSearchParams(filters)
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
      void fetchPage(filters, null, 'replace')
    }, DEBOUNCE_MS)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const handleChange = useCallback((partial: Partial<FiltersValue>) => {
    setShowIgnoredNotice(false)
    setFiltersState((current) => ({ ...current, ...partial }))
  }, [])

  const handleReset = useCallback(() => {
    setShowIgnoredNotice(false)
    setFiltersState({ q: '', country: '', city: '', specialty: '', technology: '', workMode: '', pfe: false, language: '', sort: 'newest' })
  }, [])

  const handleLoadMore = useCallback(() => {
    if (nextCursor) void fetchPage(filters, nextCursor, 'append')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCursor, filters])

  const { states, pagination } = dictionary.offers

  return (
    <div>
      <div aria-live="polite" className="sr-only" data-testid="offers-live-region">
        {liveMessage}
      </div>

      {showIgnoredNotice && (
        <p role="status" className="mb-4 rounded-md border border-line bg-paper-raised p-3 text-sm text-ink-soft">
          {dictionary.offers.filters.ignoredNotice}
        </p>
      )}

      <FiltersPanel dictionary={dictionary} value={filters} onChange={handleChange} onReset={handleReset} />

      {freshness.stale && <div className="mt-6"><FreshnessBanner dictionary={dictionary} /></div>}

      <div className="mt-6">
        {status === 'loading' ? (
          <p className="py-10 text-center text-sm text-ink-muted">{states.loading}</p>
        ) : status === 'error' ? (
          <p className="py-10 text-center text-sm text-accent-dark">{states.error}</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">{states.empty}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                dictionary={dictionary}
                locale={locale}
                isFavorite={isFavorite(offer.id)}
                onToggleFavorite={() => toggleFavorite(offer.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {loadMoreFailed && (
        <p role="alert" className="mt-4 text-center text-sm text-accent-dark">
          {states.error}
        </p>
      )}

      {nextCursor && status !== 'loading' && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={status === 'loadingMore'}
            className="rounded-pill bg-primary px-5 py-2.5 text-sm font-semibold text-paper hover:bg-primary-dark disabled:opacity-60"
          >
            {status === 'loadingMore' ? pagination.loadingMore : pagination.loadMore}
          </button>
        </div>
      )}

      <p className="mt-6 text-center text-xs text-ink-muted">{dictionary.offers.favorites.deviceOnlyNotice}</p>
    </div>
  )
}
