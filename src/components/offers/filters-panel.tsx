'use client'

import { SPECIALTY_SLUGS, type SpecialtySlug } from '@/lib/ingestion/dictionaries/specialties'
import { TECHNOLOGY_NAMES } from '@/lib/ingestion/dictionaries/technologies'
import type { Dictionary } from '@/lib/i18n/types'
import { specialtyLabel } from '@/lib/offers/specialty-labels'
import type { OffersSort } from '@/lib/offers/query-schema'

export interface FiltersValue {
  q: string
  country: '' | 'MA' | 'FR'
  city: string
  specialty: '' | SpecialtySlug
  technology: string
  workMode: '' | 'onsite' | 'hybrid' | 'remote' | 'unknown'
  pfe: boolean
  language: '' | 'fr' | 'en'
  sort: OffersSort
}

interface FiltersPanelProps {
  dictionary: Dictionary
  value: FiltersValue
  onChange(partial: Partial<FiltersValue>): void
  onReset(): void
}

export function FiltersPanel({ dictionary, value, onChange, onReset }: FiltersPanelProps) {
  const { filters, workModeLabels } = dictionary.offers

  return (
    <form
      role="search"
      aria-label={filters.heading}
      className="grid gap-4 rounded-md border border-line bg-paper-raised p-5 shadow-card sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="flex flex-col gap-1.5 lg:col-span-3">
        <label htmlFor="offers-q" className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {filters.searchLabel}
        </label>
        <input
          id="offers-q"
          type="search"
          value={value.q}
          placeholder={filters.searchPlaceholder}
          onChange={(event) => onChange({ q: event.target.value })}
          className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
          maxLength={100}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="offers-country" className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {filters.countryLabel}
        </label>
        <select
          id="offers-country"
          value={value.country}
          onChange={(event) => onChange({ country: event.target.value as FiltersValue['country'] })}
          className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
        >
          <option value="">{filters.countryAny}</option>
          <option value="MA">{filters.countryOptions.MA}</option>
          <option value="FR">{filters.countryOptions.FR}</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="offers-city" className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {filters.cityLabel}
        </label>
        <input
          id="offers-city"
          type="text"
          value={value.city}
          placeholder={filters.cityPlaceholder}
          onChange={(event) => onChange({ city: event.target.value })}
          className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
          maxLength={80}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="offers-specialty" className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {filters.specialtyLabel}
        </label>
        <select
          id="offers-specialty"
          value={value.specialty}
          onChange={(event) => onChange({ specialty: event.target.value as FiltersValue['specialty'] })}
          className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
        >
          <option value="">{filters.specialtyAny}</option>
          {SPECIALTY_SLUGS.map((slug) => (
            <option key={slug} value={slug}>
              {specialtyLabel(slug, dictionary)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="offers-technology" className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {filters.technologyLabel}
        </label>
        <select
          id="offers-technology"
          value={value.technology}
          onChange={(event) => onChange({ technology: event.target.value })}
          className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
        >
          <option value="">{filters.technologyAny}</option>
          {TECHNOLOGY_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="offers-work-mode" className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {filters.workModeLabel}
        </label>
        <select
          id="offers-work-mode"
          value={value.workMode}
          onChange={(event) => onChange({ workMode: event.target.value as FiltersValue['workMode'] })}
          className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
        >
          <option value="">{filters.workModeAny}</option>
          <option value="onsite">{workModeLabels.onsite}</option>
          <option value="hybrid">{workModeLabels.hybrid}</option>
          <option value="remote">{workModeLabels.remote}</option>
          <option value="unknown">{workModeLabels.unknown}</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="offers-language" className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {filters.languageLabel}
        </label>
        <select
          id="offers-language"
          value={value.language}
          onChange={(event) => onChange({ language: event.target.value as FiltersValue['language'] })}
          className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
        >
          <option value="">{filters.languageAny}</option>
          <option value="fr">{filters.languageOptions.fr}</option>
          <option value="en">{filters.languageOptions.en}</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="offers-sort" className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {filters.sortLabel}
        </label>
        <select
          id="offers-sort"
          value={value.sort}
          onChange={(event) => onChange({ sort: event.target.value as OffersSort })}
          className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
        >
          <option value="newest">{filters.sortOptions.newest}</option>
          <option value="recently-seen">{filters.sortOptions.recentlySeen}</option>
        </select>
      </div>

      <div className="flex items-end gap-2">
        <input
          id="offers-pfe"
          type="checkbox"
          checked={value.pfe}
          onChange={(event) => onChange({ pfe: event.target.checked })}
          className="size-4"
        />
        <label htmlFor="offers-pfe" className="text-sm">
          {filters.pfeLabel}
        </label>
      </div>

      <div className="flex items-end lg:col-span-3">
        <button
          type="button"
          onClick={onReset}
          className="rounded-pill border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:text-ink"
        >
          {filters.resetLabel}
        </button>
      </div>
    </form>
  )
}
