import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { LOCALES } from '@/lib/i18n/config'
import type { PublicOfferSummary } from '@/lib/offers/public-offer'
import { OfferCard } from './offer-card'

function offer(overrides: Partial<PublicOfferSummary> = {}): PublicOfferSummary {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Stage Développeur Full Stack',
    company: 'Acme',
    country: 'MA',
    city: 'Casablanca',
    region: null,
    workMode: 'remote',
    isPfe: false,
    specialties: ['software-web-mobile'],
    technologies: ['React'],
    language: 'fr',
    publishedAt: '2026-01-15T00:00:00.000Z',
    sourceName: 'Inetum',
    attributionUrl: 'https://jobs.smartrecruiters.com/Inetum2',
    ...overrides,
  }
}

describe('OfferCard', () => {
  for (const locale of LOCALES) {
    const dictionary = getDictionary(locale)

    it(`renders title, company, location, work mode, specialties, technologies, and source (${locale})`, () => {
      render(
        <OfferCard offer={offer()} dictionary={dictionary} locale={locale} isFavorite={false} onToggleFavorite={vi.fn()} />,
      )
      expect(screen.getByRole('heading', { name: /Stage Développeur Full Stack/ })).toBeInTheDocument()
      expect(screen.getByText('Acme')).toBeInTheDocument()
      expect(screen.getByText(/Casablanca/)).toBeInTheDocument()
      expect(screen.getByText(dictionary.offers.workModeLabels.remote)).toBeInTheDocument()
      expect(screen.getByText(dictionary.specialties.items.softwareWebMobile.label)).toBeInTheDocument()
      expect(screen.getByText('React')).toBeInTheDocument()
      expect(screen.getByText(dictionary.offers.card.sourceLabel.replace('{name}', 'Inetum'))).toBeInTheDocument()
    })

    it(`renders the PFE badge only when isPfe is true (${locale})`, () => {
      const { rerender } = render(
        <OfferCard offer={offer({ isPfe: false })} dictionary={dictionary} locale={locale} isFavorite={false} onToggleFavorite={vi.fn()} />,
      )
      expect(screen.queryByText(dictionary.offers.card.pfeBadge)).not.toBeInTheDocument()

      rerender(
        <OfferCard offer={offer({ isPfe: true })} dictionary={dictionary} locale={locale} isFavorite={false} onToggleFavorite={vi.fn()} />,
      )
      expect(screen.getByText(dictionary.offers.card.pfeBadge)).toBeInTheDocument()
    })

    it(`renders translated fallbacks for null city and null publishedAt (${locale})`, () => {
      render(
        <OfferCard
          offer={offer({ city: null, region: null, publishedAt: null })}
          dictionary={dictionary}
          locale={locale}
          isFavorite={false}
          onToggleFavorite={vi.fn()}
        />,
      )
      expect(screen.getByText(dictionary.offers.card.unknownLocation)).toBeInTheDocument()
      expect(screen.getByText(dictionary.offers.card.unknownDate)).toBeInTheDocument()
    })

    it(`toggles the favorite button's aria-pressed and calls the callback (${locale})`, async () => {
      const onToggleFavorite = vi.fn()
      render(
        <OfferCard offer={offer()} dictionary={dictionary} locale={locale} isFavorite={false} onToggleFavorite={onToggleFavorite} />,
      )
      const button = screen.getByRole('button', { name: dictionary.offers.favorites.add })
      expect(button).toHaveAttribute('aria-pressed', 'false')
      await userEvent.click(button)
      expect(onToggleFavorite).toHaveBeenCalledTimes(1)
    })

    it(`shows the remove-favorite label when isFavorite is true (${locale})`, () => {
      render(
        <OfferCard offer={offer()} dictionary={dictionary} locale={locale} isFavorite={true} onToggleFavorite={vi.fn()} />,
      )
      expect(screen.getByRole('button', { name: dictionary.offers.favorites.remove })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })
  }
})
