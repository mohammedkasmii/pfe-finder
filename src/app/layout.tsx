import type { Metadata } from 'next'
import { IBM_Plex_Sans, Piazzolla } from 'next/font/google'
import type { ReactNode } from 'react'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { getLocale } from '@/lib/i18n/locale'
import { env } from '@/lib/env'
import './globals.css'

const displayFont = Piazzolla({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
  variable: '--next-font-display',
})

const bodyFont = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--next-font-body',
})

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  const dictionary = getDictionary(locale)
  return {
    metadataBase: new URL(env.siteUrl),
    title: dictionary.meta.title,
    description: dictionary.meta.description,
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  const dictionary = getDictionary(locale)

  return (
    <html lang={locale} className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>
        <a href="#main-content" className="skip-link">
          {dictionary.skipLink}
        </a>
        {children}
      </body>
    </html>
  )
}
