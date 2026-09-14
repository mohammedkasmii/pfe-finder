import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE_NAME, type Locale } from './config'

/**
 * Reads the visitor's locale preference from the request cookie set by
 * `setLocaleAction`. Reading `cookies()` here makes every page that calls
 * this dynamic per-request, which is also what the CSP nonce in
 * `src/proxy.ts` requires.
 */
export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies()
  const value = cookieStore.get(LOCALE_COOKIE_NAME)?.value
  return isLocale(value) ? value : DEFAULT_LOCALE
}
