export interface NormalizedLocation {
  country: 'MA' | 'FR'
  city: string | null
  region: string | null
}

const COUNTRY_ALIASES: Record<string, 'MA' | 'FR'> = {
  MA: 'MA',
  MAR: 'MA',
  MOROCCO: 'MA',
  MAROC: 'MA',
  FR: 'FR',
  FRA: 'FR',
  FRANCE: 'FR',
}

export function normalizeLocation(raw: {
  country?: string | null
  city?: string | null
  region?: string | null
}): NormalizedLocation | null {
  if (!raw.country) return null
  const country = COUNTRY_ALIASES[raw.country.trim().toUpperCase()]
  if (!country) return null
  return {
    country,
    city: raw.city?.trim() ? raw.city.trim().slice(0, 80) : null,
    region: raw.region?.trim() ? raw.region.trim().slice(0, 80) : null,
  }
}
