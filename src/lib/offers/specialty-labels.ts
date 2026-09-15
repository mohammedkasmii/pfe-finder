import type { SpecialtySlug } from '../ingestion/dictionaries/specialties'
import type { Dictionary } from '../i18n/types'

const SLUG_TO_DICTIONARY_KEY: Record<SpecialtySlug, keyof Dictionary['specialties']['items']> = {
  'software-web-mobile': 'softwareWebMobile',
  'data-ai': 'dataAi',
  cybersecurity: 'cybersecurity',
  'cloud-devops': 'cloudDevops',
  'systems-networks': 'systemsNetworks',
  'qa-testing': 'qaTesting',
}

export function specialtyLabel(slug: SpecialtySlug, dictionary: Dictionary): string {
  const key = SLUG_TO_DICTIONARY_KEY[slug]
  return dictionary.specialties.items[key].label
}
