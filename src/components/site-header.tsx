import Link from 'next/link'
import type { Locale } from '@/lib/i18n/config'
import type { Dictionary } from '@/lib/i18n/types'
import { LanguageSwitch } from './language-switch'
import { LogoMark } from './logo-mark'

interface SiteHeaderProps {
  locale: Locale
  dictionary: Dictionary
}

export function SiteHeader({ locale, dictionary }: SiteHeaderProps) {
  return (
    <header className="border-b border-line">
      <div className="tick-divider" />
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5 sm:px-10">
        <div className="flex items-center gap-3">
          <LogoMark />
          <div className="flex flex-col leading-tight">
            <span className="font-display text-lg font-bold">PFE Finder</span>
            <span className="text-xs tracking-wide text-ink-muted uppercase">Maroc · France</span>
          </div>
        </div>

        <nav aria-label={dictionary.nav.home} className="order-3 flex w-full justify-center gap-8 text-sm font-medium sm:order-2 sm:w-auto">
          <Link href="/" className="hover:text-primary">
            {dictionary.nav.home}
          </Link>
          <Link href="/offers" className="hover:text-primary">
            {dictionary.nav.offers}
          </Link>
          <Link href="/#how-it-works" className="hover:text-primary">
            {dictionary.nav.howItWorks}
          </Link>
          <Link href="/#specialties" className="hover:text-primary">
            {dictionary.nav.specialties}
          </Link>
        </nav>

        <div className="order-2 sm:order-3">
          <LanguageSwitch locale={locale} dictionary={dictionary} />
        </div>
      </div>
    </header>
  )
}
