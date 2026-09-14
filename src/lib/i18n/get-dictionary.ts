import type { Locale } from './config'
import { en } from './dictionaries/en'
import { fr } from './dictionaries/fr'
import type { Dictionary } from './types'

const dictionaries: Record<Locale, Dictionary> = { fr, en }

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale]
}
