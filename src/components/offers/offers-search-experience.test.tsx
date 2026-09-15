import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import type { OffersQuery } from '@/lib/offers/query-schema'
import type { PublicOfferSummary } from '@/lib/offers/public-offer'
import type { SearchOffersResult } from '@/lib/offers/search-offers'
import { OffersSearchExperience } from './offers-search-experience'

const replaceMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/offers',
}))

const dictionary = getDictionary('fr')

function offer(overrides: Partial<PublicOfferSummary> = {}): PublicOfferSummary {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Stage Développeur',
    company: 'Acme',
    country: 'MA',
    city: 'Casablanca',
    region: null,
    workMode: 'onsite',
    isPfe: false,
    specialties: [],
    technologies: [],
    language: 'fr',
    publishedAt: null,
    sourceName: 'Inetum',
    attributionUrl: 'https://jobs.smartrecruiters.com/Inetum2',
    ...overrides,
  }
}

const defaultQuery: OffersQuery = { sort: 'newest', limit: 12 }
const defaultResult: SearchOffersResult = {
  items: [offer()],
  nextCursor: null,
  freshness: { stale: false, mostRecentSuccessAt: '2026-01-01T00:00:00.000Z' },
}

describe('OffersSearchExperience', () => {
  beforeEach(() => {
    replaceMock.mockClear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ items: [offer({ title: 'Updated result' })], nextCursor: null, freshness: defaultResult.freshness }),
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders the initial results with no fetch on mount', () => {
    render(
      <OffersSearchExperience
        initialQuery={defaultQuery}
        initialResult={defaultResult}
        ignoredKeys={[]}
        dictionary={dictionary}
        locale="fr"
      />,
    )
    expect(screen.getByText('Stage Développeur')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('changing the country filter triggers a debounced fetch and updates the URL', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(
      <OffersSearchExperience
        initialQuery={defaultQuery}
        initialResult={defaultResult}
        ignoredKeys={[]}
        dictionary={dictionary}
        locale="fr"
      />,
    )

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.selectOptions(screen.getByLabelText(dictionary.offers.filters.countryLabel), 'MA')

    await act(async () => { await vi.advanceTimersByTimeAsync(400) })

    expect(fetch).toHaveBeenCalledTimes(1)
    const calledUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(calledUrl).toContain('country=MA')
    expect(replaceMock).toHaveBeenCalled()
    expect(screen.getByText('Updated result')).toBeInTheDocument()
  })

  it('announces the result count in a live region after a fetch resolves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(
      <OffersSearchExperience
        initialQuery={defaultQuery}
        initialResult={defaultResult}
        ignoredKeys={[]}
        dictionary={dictionary}
        locale="fr"
      />,
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.selectOptions(screen.getByLabelText(dictionary.offers.filters.countryLabel), 'FR')
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })

    const liveRegion = screen.getByTestId('offers-live-region')
    expect(liveRegion.textContent).toBe(dictionary.offers.states.resultsCount.replace('{count}', '1'))
  })

  it('renders the translated error state when a fetch rejects, without crashing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    render(
      <OffersSearchExperience
        initialQuery={defaultQuery}
        initialResult={defaultResult}
        ignoredKeys={[]}
        dictionary={dictionary}
        locale="fr"
      />,
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.selectOptions(screen.getByLabelText(dictionary.offers.filters.countryLabel), 'MA')
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })

    // Appears twice by design: once as the visible error message, once in
    // the sr-only live region announcing the same text to assistive tech.
    expect(screen.getAllByText(dictionary.offers.states.error).length).toBeGreaterThan(0)
  })

  it('renders the empty state when there are zero items', () => {
    render(
      <OffersSearchExperience
        initialQuery={defaultQuery}
        initialResult={{ ...defaultResult, items: [] }}
        ignoredKeys={[]}
        dictionary={dictionary}
        locale="fr"
      />,
    )
    expect(screen.getByText(dictionary.offers.states.empty)).toBeInTheDocument()
  })

  it('renders the stale-source banner when freshness.stale is true', () => {
    render(
      <OffersSearchExperience
        initialQuery={defaultQuery}
        initialResult={{ ...defaultResult, freshness: { stale: true, mostRecentSuccessAt: null } }}
        ignoredKeys={[]}
        dictionary={dictionary}
        locale="fr"
      />,
    )
    expect(screen.getByText(dictionary.offers.freshness.staleTitle)).toBeInTheDocument()
  })

  it('renders the ignored-filters notice when ignoredKeys is non-empty', () => {
    render(
      <OffersSearchExperience
        initialQuery={defaultQuery}
        initialResult={defaultResult}
        ignoredKeys={['specialty']}
        dictionary={dictionary}
        locale="fr"
      />,
    )
    expect(screen.getByText(dictionary.offers.filters.ignoredNotice)).toBeInTheDocument()
  })

  it('a stale, out-of-order response never overwrites a newer request\'s results (finding 7)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let resolveFirst!: (value: unknown) => void
    const firstResponsePromise = new Promise((resolve) => {
      resolveFirst = resolve
    })
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstResponsePromise)
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({ items: [offer({ title: 'FR result' })], nextCursor: null, freshness: defaultResult.freshness }),
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <OffersSearchExperience
        initialQuery={defaultQuery}
        initialResult={defaultResult}
        ignoredKeys={[]}
        dictionary={dictionary}
        locale="fr"
      />,
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const countrySelect = screen.getByLabelText(dictionary.offers.filters.countryLabel)

    // First (older) request: country=MA — its response will hang.
    await user.selectOptions(countrySelect, 'MA')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // Second (newer) request: country=FR — resolves immediately, before
    // the first ever does.
    await user.selectOptions(countrySelect, 'FR')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(screen.getByText('FR result')).toBeInTheDocument()

    // Now the STALE first request finally resolves. It must be ignored —
    // it must never overwrite the newer FR result already committed.
    await act(async () => {
      resolveFirst({
        ok: true,
        json: async () => ({
          items: [offer({ title: 'stale MA result' })],
          nextCursor: null,
          freshness: defaultResult.freshness,
        }),
      })
    })

    expect(screen.getByText('FR result')).toBeInTheDocument()
    expect(screen.queryByText('stale MA result')).not.toBeInTheDocument()
  })

  it('a failed load-more request keeps existing items visible and shows a controlled inline error (finding 7)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    render(
      <OffersSearchExperience
        initialQuery={defaultQuery}
        initialResult={{ ...defaultResult, nextCursor: 'some-opaque-cursor' }}
        ignoredKeys={[]}
        dictionary={dictionary}
        locale="fr"
      />,
    )

    const loadMoreButton = screen.getByRole('button', { name: dictionary.offers.pagination.loadMore })
    await act(async () => {
      loadMoreButton.click()
      await Promise.resolve()
    })

    // The originally loaded item must still be visible — a load-more
    // failure must never blank the already-loaded results.
    expect(screen.getByText('Stage Développeur')).toBeInTheDocument()
    expect(screen.getAllByText(dictionary.offers.states.error).length).toBeGreaterThan(0)
  })

  it('toggling a favorite does not trigger a re-fetch', async () => {
    render(
      <OffersSearchExperience
        initialQuery={defaultQuery}
        initialResult={defaultResult}
        ignoredKeys={[]}
        dictionary={dictionary}
        locale="fr"
      />,
    )
    const favoriteButton = screen.getByRole('button', { name: dictionary.offers.favorites.add })
    await userEvent.click(favoriteButton)
    expect(fetch).not.toHaveBeenCalled()
  })
})
