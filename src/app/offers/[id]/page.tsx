import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPublicSupabaseClient } from '@/lib/db/public-client'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { getLocale } from '@/lib/i18n/locale'
import { formatOfferDate } from '@/lib/offers/format-date'
import { getOfferById } from '@/lib/offers/get-offer'
import { specialtyLabel } from '@/lib/offers/specialty-labels'
import { ApplyLink } from '@/components/offers/apply-link'
import { FavoriteButton } from '@/components/offers/favorite-button'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'

interface OfferDetailPageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: OfferDetailPageProps): Promise<Metadata> {
  const { id } = await params
  try {
    const offer = await getOfferById(() => getPublicSupabaseClient(), id)
    if (!offer) return {}
    return { title: `${offer.title} — ${offer.company} — PFE Finder`, description: offer.descriptionText.slice(0, 200) }
  } catch {
    // Never let a database/configuration failure break metadata
    // generation — fall back to the page's default metadata instead.
    return {}
  }
}

export default async function OfferDetailPage({ params }: OfferDetailPageProps) {
  const { id } = await params
  const locale = await getLocale()
  const dictionary = getDictionary(locale)

  // `getOfferById` validates the id BEFORE ever calling this factory (M3
  // review finding 4), so a malformed id never constructs a Supabase
  // client at all and reaches `notFound()` below unconditionally. A
  // thrown `GetOfferError` (database/config failure) is caught here and
  // rendered as the distinct service-error state — never a false 404.
  let offer
  try {
    offer = await getOfferById(() => getPublicSupabaseClient(), id)
  } catch {
    return (
      <>
        <SiteHeader locale={locale} dictionary={dictionary} />
        <main id="main-content" className="mx-auto max-w-3xl px-6 py-16 text-center sm:px-10">
          <p role="alert" className="text-sm text-accent-dark">
            {dictionary.offers.states.error}
          </p>
        </main>
        <SiteFooter dictionary={dictionary} />
      </>
    )
  }
  if (!offer) {
    notFound()
  }

  const { detail, card, workModeLabels } = dictionary.offers
  const publishedDate = formatOfferDate(offer.publishedAt, locale)
  const lastVerifiedDate = formatOfferDate(offer.lastSeenAt, locale)
  const location = offer.city ? `${offer.city}, ${offer.country}` : card.unknownLocation

  return (
    <>
      <SiteHeader locale={locale} dictionary={dictionary} />
      <main id="main-content" className="mx-auto max-w-3xl px-6 py-10 sm:px-10">
        <Link href="/offers" className="text-sm font-medium text-primary hover:underline">
          ← {detail.backToSearch}
        </Link>

        <div className="mt-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold sm:text-3xl">{offer.title}</h1>
            <p className="mt-1 text-base font-medium text-ink-soft">{offer.company}</p>
            <p className="mt-1 text-sm text-ink-muted">{location}</p>
          </div>
          <FavoriteButton offerId={offer.id} dictionary={dictionary} />
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
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

        <div className="mt-6">
          <ApplyLink href={offer.applyUrl} label={detail.applyButton} unavailableLabel={detail.applyUnavailable} />
        </div>

        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold">{detail.descriptionHeading}</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{offer.descriptionText}</p>
        </section>

        <section className="mt-10 border-t border-line pt-6 text-sm text-ink-muted">
          <h2 className="font-display text-base font-semibold text-ink">{detail.sourceHeading}</h2>
          <p className="mt-2">{card.sourceLabel.replace('{name}', offer.sourceName)}</p>
          {publishedDate && <p className="mt-1">{card.publishedOn.replace('{date}', publishedDate)}</p>}
          {lastVerifiedDate && <p className="mt-1">{detail.lastVerified.replace('{date}', lastVerifiedDate)}</p>}
          {offer.sourceUrl && offer.sourceUrl.startsWith('https://') && (
            <p className="mt-1">
              <a href={offer.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {offer.attributionUrl}
              </a>
            </p>
          )}
        </section>
      </main>
      <SiteFooter dictionary={dictionary} />
    </>
  )
}
