import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { LOCALES } from '@/lib/i18n/config'
import { CoverageSection } from './coverage-section'
import { Hero } from './hero'
import { HowItWorks } from './how-it-works'
import { SiteFooter } from './site-footer'
import { SiteHeader } from './site-header'
import { SpecialtiesGrid } from './specialties-grid'

describe('homepage sections', () => {
  for (const locale of LOCALES) {
    const dictionary = getDictionary(locale)

    it(`renders the header as a banner landmark with working navigation (${locale})`, () => {
      render(<SiteHeader locale={locale} dictionary={dictionary} />)
      expect(screen.getByRole('banner')).toBeInTheDocument()
      expect(screen.getByRole('navigation')).toBeInTheDocument()
      expect(screen.getByText('PFE Finder')).toBeInTheDocument()
    })

    it(`renders exactly one level-1 heading with the hero title (${locale})`, () => {
      render(<Hero dictionary={dictionary} />)
      const headings = screen.getAllByRole('heading', { level: 1 })
      expect(headings).toHaveLength(1)
      expect(headings[0]).toHaveTextContent(dictionary.hero.title)
    })

    it(`renders all three how-it-works steps as a list (${locale})`, () => {
      render(<HowItWorks dictionary={dictionary} />)
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
      for (const step of dictionary.howItWorks.steps) {
        expect(screen.getByText(step.title)).toBeInTheDocument()
      }
    })

    it(`renders all six specialties (${locale})`, () => {
      render(<SpecialtiesGrid dictionary={dictionary} />)
      expect(screen.getAllByRole('listitem')).toHaveLength(6)
      for (const item of Object.values(dictionary.specialties.items)) {
        expect(screen.getByText(item.label)).toBeInTheDocument()
      }
    })

    it(`renders both country coverage blocks (${locale})`, () => {
      render(<CoverageSection dictionary={dictionary} />)
      expect(screen.getByText('MA')).toBeInTheDocument()
      expect(screen.getByText('FR')).toBeInTheDocument()
    })

    it(`renders the footer as a contentinfo landmark (${locale})`, () => {
      render(<SiteFooter dictionary={dictionary} />)
      expect(screen.getByRole('contentinfo')).toBeInTheDocument()
      expect(screen.getByText(dictionary.footer.copyright)).toBeInTheDocument()
    })
  }
})
