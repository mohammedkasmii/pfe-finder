'use client'

import Link from 'next/link'
import type { Locale } from '@/lib/i18n/config'
import type { Dictionary } from '@/lib/i18n/types'
import { formatOfferDate } from '@/lib/offers/format-date'
import type { PublicOfferSummary } from '@/lib/offers/public-offer'
import { specialtyLabel } from '@/lib/offers/specialty-labels'

interface OfferCardProps {
  offer: PublicOfferSummary
  dictionary: Dictionary
  locale: Locale
  isFavorite: boolean
  onToggleFavorite: () => void
}

export function OfferCard({ offer, dictionary, locale, isFavorite, onToggleFavorite }: OfferCardProps) {
  const { card, workModeLabels, favorites } = dictionary.offers
  const location = offer.city ? `${offer.city}, ${offer.country}` : card.unknownLocation
  const publishedDate = formatOfferDate(offer.publishedAt, locale)

  return (
    <li className="rounded-md border border-line bg-paper-raised p-6 shadow-card transition-shadow hover:shadow-card-hover">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg font-semibold leading-snug">
          <Link href={`/offers/${offer.id}`} className="hover:text-primary hover:underline">
            {offer.title}
          </Link>
        </h3>
        <button
          type="button"
          aria-pressed={isFavorite}
          aria-label={isFavorite ? favorites.remove : favorites.add}
          onClick={onToggleFavorite}
          className={
            isFavorite
              ? 'shrink-0 rounded-pill bg-accent px-3 py-1 text-xs font-semibold text-paper'
              : 'shrink-0 rounded-pill border border-line px-3 py-1 text-xs font-semibold text-ink-soft hover:text-ink'
          }
        >
          {isFavorite ? '♥' : '♡'}
        </button>
      </div>

      <p className="mt-1 text-sm font-medium text-ink-soft">{offer.company}</p>
      <p className="mt-1 text-sm text-ink-muted">{location}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {offer.isPfe && (
          <span className="rounded-pill bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent-dark">
            {card.pfeBadge}
          </span>
        )}
        <span className="rounded-pill bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary-dark">
          {workModeLabels[offer.workMode]}
        </span>
        {offer.specialties.map((slug) => (
          <span key={slug} className="rounded-pill border border-line px-2.5 py-0.5 text-xs text-ink-soft">
            {specialtyLabel(slug, dictionary)}
          </span>
        ))}
        {offer.technologies.map((tech) => (
          <span key={tech} className="rounded-pill border border-line px-2.5 py-0.5 text-xs text-ink-soft">
            {tech}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-ink-muted">
        <span>{publishedDate ? card.publishedOn.replace('{date}', publishedDate) : card.unknownDate}</span>
        <span>{card.sourceLabel.replace('{name}', offer.sourceName)}</span>
      </div>
    </li>
  )
}
