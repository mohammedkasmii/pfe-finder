import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { getPublicSupabaseClient } from '@/lib/db/public-client'
import { env } from '@/lib/env'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { getLocale } from '@/lib/i18n/locale'
import { normalizeOffersSearchParams } from '@/lib/offers/query-schema'
import { searchOffers, type SearchOffersParams } from '@/lib/offers/search-offers'
import { getClientIp } from '@/lib/rate-limit/client-ip'
import { checkRateLimit } from '@/lib/rate-limit/limiter'
import { OffersSearchExperience } from '@/components/offers/offers-search-experience'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'

interface OffersPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  const dictionary = getDictionary(locale)
  return {
    title: `${dictionary.offers.pageTitle} — PFE Finder`,
    description: dictionary.offers.pageDescription,
  }
}

const EMPTY_RESULT = { items: [], nextCursor: null, freshness: { stale: true, mostRecentSuccessAt: null } }

export default async function OffersPage({ searchParams }: OffersPageProps) {
  const locale = await getLocale()
  const dictionary = getDictionary(locale)

  // M3 review finding 5: the SSR path must be rate-limited too, or a
  // client can bypass GET /api/offers's limiter entirely by repeatedly
  // requesting /offers itself (which calls searchOffers directly, with
  // no HTTP hop). Same identifier scheme, same limiter instance.
  const requestHeaders = await headers()
  const ip = getClientIp(requestHeaders)
  const { allowed } = await checkRateLimit(`offers:${ip}`)
  if (!allowed) {
    return (
      <>
        <SiteHeader locale={locale} dictionary={dictionary} />
        <main id="main-content" className="mx-auto max-w-3xl px-6 py-16 text-center sm:px-10">
          <p role="alert" className="text-sm text-accent-dark">
            {dictionary.offers.states.rateLimited}
          </p>
        </main>
        <SiteFooter dictionary={dictionary} />
      </>
    )
  }

  const rawParams = await searchParams

  const { query, ignoredKeys } = normalizeOffersSearchParams(rawParams)

  const params: SearchOffersParams = {
    q: query.q,
    country: query.country,
    city: query.city,
    specialty: query.specialty,
    technology: query.technology,
    workMode: query.workMode,
    pfe: query.pfe,
    language: query.language,
    sort: query.sort,
    cursor: query.cursor,
    limit: query.limit,
  }

  // Never let a database/configuration failure crash the page render — the
  // client search experience already has its own translated error state
  // for a failed re-fetch; the very first, server-rendered load must
  // degrade to that same accessible state instead of Next's generic
  // fallback UI. A tampered/expired cursor reaching the page directly
  // (e.g. an old bookmarked URL) gets one retry without it before falling
  // back to the empty/error result, matching "safely ignore or normalize
  // invalid page URL filters".
  let initialResult
  let serviceError = false
  try {
    initialResult = await searchOffers(getPublicSupabaseClient(), params, { cursorSecret: env.cursorSecret })
  } catch {
    try {
      initialResult = await searchOffers(
        getPublicSupabaseClient(),
        { ...params, cursor: undefined },
        { cursorSecret: env.cursorSecret },
      )
    } catch {
      initialResult = EMPTY_RESULT
      serviceError = true
    }
  }

  return (
    <>
      <SiteHeader locale={locale} dictionary={dictionary} />
      <main id="main-content" className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">{dictionary.offers.pageTitle}</h1>
        <p className="mt-2 text-sm text-ink-soft sm:text-base">{dictionary.offers.pageDescription}</p>
        <div className="mt-8">
          {serviceError ? (
            <p role="alert" className="py-10 text-center text-sm text-accent-dark">
              {dictionary.offers.states.error}
            </p>
          ) : (
            <OffersSearchExperience
              initialQuery={query}
              initialResult={initialResult}
              ignoredKeys={ignoredKeys}
              dictionary={dictionary}
              locale={locale}
            />
          )}
        </div>
      </main>
      <SiteFooter dictionary={dictionary} />
    </>
  )
}
