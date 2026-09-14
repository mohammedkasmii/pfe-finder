'use server'

import { cookies } from 'next/headers'
import { isLocale, LOCALE_COOKIE_NAME } from '@/lib/i18n/config'
import { env } from '@/lib/env'

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365

/**
 * Sets the visitor's locale preference. Invoked from a plain HTML `<form>`
 * (see `LanguageSwitch`), so language switching works with JavaScript
 * disabled and is fully keyboard-operable via native submit buttons —
 * no client component required for this interaction.
 */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const requested = formData.get('locale')
  if (typeof requested !== 'string' || !isLocale(requested)) {
    return
  }
  const cookieStore = await cookies()
  cookieStore.set(LOCALE_COOKIE_NAME, requested, {
    path: '/',
    maxAge: ONE_YEAR_IN_SECONDS,
    sameSite: 'lax',
    httpOnly: true,
    secure: env.appEnv === 'production',
  })
}
