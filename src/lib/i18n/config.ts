export const LOCALES = ['fr', 'en'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'fr'

export const LOCALE_COOKIE_NAME = 'pfe_locale'

export function isLocale(value: string | undefined | null): value is Locale {
  if (typeof value !== 'string') return false
  return (LOCALES as readonly string[]).includes(value)
}
