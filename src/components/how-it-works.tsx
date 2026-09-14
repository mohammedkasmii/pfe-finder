import type { Dictionary } from '@/lib/i18n/types'

interface HowItWorksProps {
  dictionary: Dictionary
}

export function HowItWorks({ dictionary }: HowItWorksProps) {
  const { howItWorks } = dictionary
  return (
    <section id="how-it-works" className="border-y border-line bg-paper-raised px-6 py-16 sm:px-10 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 className="font-display text-2xl font-semibold sm:text-3xl">{howItWorks.title}</h2>
        <ol className="mt-10 grid gap-10 sm:grid-cols-3">
          {howItWorks.steps.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-3">
              <span className="font-display text-3xl font-bold text-accent" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="text-lg font-semibold">{step.title}</h3>
              <p className="text-[0.925rem] leading-relaxed text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
