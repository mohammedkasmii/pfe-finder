import type { Dictionary } from '@/lib/i18n/types'

interface CoverageSectionProps {
  dictionary: Dictionary
}

export function CoverageSection({ dictionary }: CoverageSectionProps) {
  const { coverage } = dictionary
  return (
    <section className="bg-ink px-6 py-16 text-paper sm:px-10 sm:py-20">
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-2">
        <div>
          <span className="font-display text-4xl font-bold text-accent">{coverage.morocco.code}</span>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-invert">{coverage.morocco.body}</p>
        </div>
        <div>
          <span className="font-display text-4xl font-bold text-accent">{coverage.france.code}</span>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-invert">{coverage.france.body}</p>
        </div>
      </div>
    </section>
  )
}
