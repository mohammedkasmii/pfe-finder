import { CoverageSection } from '@/components/coverage-section'
import { Hero } from '@/components/hero'
import { HowItWorks } from '@/components/how-it-works'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { SpecialtiesGrid } from '@/components/specialties-grid'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { getLocale } from '@/lib/i18n/locale'

export default async function HomePage() {
  const locale = await getLocale()
  const dictionary = getDictionary(locale)

  return (
    <>
      <SiteHeader locale={locale} dictionary={dictionary} />
      <main id="main-content">
        <Hero dictionary={dictionary} />
        <HowItWorks dictionary={dictionary} />
        <SpecialtiesGrid dictionary={dictionary} />
        <CoverageSection dictionary={dictionary} />
      </main>
      <SiteFooter dictionary={dictionary} />
    </>
  )
}
