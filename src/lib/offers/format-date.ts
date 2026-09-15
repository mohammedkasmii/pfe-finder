import type { Locale } from '../i18n/config'

/** Formats an ISO date string per-locale, or returns `null` for a missing date. */
export function formatOfferDate(iso: string | null, locale: Locale): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}
