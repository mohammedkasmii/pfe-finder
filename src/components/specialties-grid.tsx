import type { ComponentType } from 'react'
import type { Dictionary } from '@/lib/i18n/types'
import {
  CloudIcon,
  DataIcon,
  NetworkIcon,
  QaIcon,
  SecurityIcon,
  SoftwareIcon,
} from './specialty-icons'

interface SpecialtiesGridProps {
  dictionary: Dictionary
}

export function SpecialtiesGrid({ dictionary }: SpecialtiesGridProps) {
  const { specialties } = dictionary
  const items: Array<{ icon: ComponentType; label: string }> = [
    { icon: SoftwareIcon, label: specialties.items.softwareWebMobile.label },
    { icon: DataIcon, label: specialties.items.dataAi.label },
    { icon: SecurityIcon, label: specialties.items.cybersecurity.label },
    { icon: CloudIcon, label: specialties.items.cloudDevops.label },
    { icon: NetworkIcon, label: specialties.items.systemsNetworks.label },
    { icon: QaIcon, label: specialties.items.qaTesting.label },
  ]

  return (
    <section id="specialties" className="px-6 py-16 sm:px-10 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 className="font-display text-2xl font-semibold sm:text-3xl">{specialties.title}</h2>
        <p className="mt-2 text-sm text-ink-soft sm:text-base">{specialties.description}</p>
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ icon: Icon, label }) => (
            <li
              key={label}
              className="rounded-md border border-line bg-paper-raised p-6 shadow-card transition-shadow hover:shadow-card-hover"
            >
              <Icon />
              <h3 className="mt-3.5 text-[0.95rem] font-semibold">{label}</h3>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
