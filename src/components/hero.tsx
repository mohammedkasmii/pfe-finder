import type { Dictionary } from '@/lib/i18n/types'
import { RouteMotif } from './route-motif'

interface HeroProps {
  dictionary: Dictionary
}

export function Hero({ dictionary }: HeroProps) {
  const { hero } = dictionary
  return (
    <section className="relative overflow-hidden px-6 pt-16 pb-20 sm:px-10 sm:pt-24 sm:pb-24">
      <RouteMotif
        fromLabel={hero.routeFrom}
        toLabel={hero.routeTo}
        className="pointer-events-none absolute -right-10 top-8 hidden w-[38rem] opacity-50 md:block"
      />
      <div className="relative mx-auto max-w-6xl">
        <div className="max-w-xl">
          <p className="mb-4 text-xs font-semibold tracking-wide text-accent uppercase">{hero.eyebrow}</p>
          <h1 className="text-display font-display leading-tight font-semibold sm:text-display-lg">
            {hero.title}
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-ink-soft sm:text-lg">
            {hero.description}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="#specialties"
              className="rounded-md bg-primary px-6 py-3.5 text-sm font-semibold text-paper shadow-card hover:bg-primary-dark hover:shadow-card-hover"
            >
              {hero.ctaPrimary}
            </a>
            <a href="#how-it-works" className="text-sm font-semibold text-primary hover:text-primary-dark">
              {hero.ctaSecondary} →
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
