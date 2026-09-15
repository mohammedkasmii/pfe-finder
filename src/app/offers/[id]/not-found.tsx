import Link from 'next/link'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { getLocale } from '@/lib/i18n/locale'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'

export default async function OfferNotFound() {
  const locale = await getLocale()
  const dictionary = getDictionary(locale)
  const { detail } = dictionary.offers

  return (
    <>
      <SiteHeader locale={locale} dictionary={dictionary} />
      <main id="main-content" className="mx-auto max-w-3xl px-6 py-16 text-center sm:px-10">
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">{detail.notFoundTitle}</h1>
        <p className="mt-3 text-sm text-ink-soft sm:text-base">{detail.notFoundBody}</p>
        <Link href="/offers" className="mt-6 inline-block rounded-pill bg-primary px-5 py-2.5 text-sm font-semibold text-paper hover:bg-primary-dark">
          {detail.notFoundBackLink}
        </Link>
      </main>
      <SiteFooter dictionary={dictionary} />
    </>
  )
}
