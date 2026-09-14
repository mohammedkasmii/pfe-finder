import { classifyPosting } from '../../ingestion/classification'
import { sanitizeDescriptionToPlainText } from '../../ingestion/html'
import { normalizeLocation } from '../../ingestion/location'
import type { NormalizedCandidate } from '../../ingestion/types'
import { computeCanonicalUrlHash, validateAllowlistedHttpsUrl } from '../../ingestion/urls'
import type { SourceConfig } from '../registry'
import type { SmartRecruitersDetailResponse } from './schema'

const FRENCH_MARKERS = /\b(le|la|les|des|un|une|et|pour|avec|vous|nous|stage|d[ée]veloppeur)\b/gi
const ENGLISH_MARKERS = /\b(the|and|for|with|you|we|internship|developer)\b/gi

// Lightweight heuristic, not a real language detector: counts French vs.
// English stopword hits and picks the higher count, defaulting to French
// on a tie or empty text. Documented limitation — good enough for two
// languages with this much stopword divergence, not a general solution.
function detectLanguage(text: string): 'fr' | 'en' {
  const frenchHits = (text.match(FRENCH_MARKERS) ?? []).length
  const englishHits = (text.match(ENGLISH_MARKERS) ?? []).length
  return englishHits > frenchHits ? 'en' : 'fr'
}

/**
 * Never throws: an external, untrusted `releasedDate` string that doesn't
 * parse as a valid date becomes `null` (docs/SOURCES.md: "leave it null
 * rather than inventing a date") instead of crashing the collector via
 * `Invalid Date.toISOString()`'s `RangeError`.
 */
function parseReleasedDate(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function normalizeSmartRecruitersPosting(
  detail: SmartRecruitersDetailResponse,
  source: SourceConfig,
): NormalizedCandidate | null {
  const descriptionHtml = [
    detail.jobAd?.sections?.jobDescription?.text,
    detail.jobAd?.sections?.qualifications?.text,
  ]
    .filter((text): text is string => Boolean(text))
    .join('\n')
  const descriptionText = sanitizeDescriptionToPlainText(descriptionHtml)

  const classification = classifyPosting({ title: detail.name, descriptionText })
  if (!classification) return null

  const location = normalizeLocation({
    country: detail.location?.country,
    city: detail.location?.city,
    region: detail.location?.region,
  })
  if (!location || !source.countries.includes(location.country)) return null

  const sourceUrlRaw = `https://jobs.smartrecruiters.com/${source.employerIdentifier}/${detail.id}`
  const applyUrlRaw = detail.applyUrl ?? sourceUrlRaw
  const sourceUrlValidation = validateAllowlistedHttpsUrl(sourceUrlRaw, ['jobs.smartrecruiters.com'])
  const applyUrlValidation = validateAllowlistedHttpsUrl(applyUrlRaw, ['jobs.smartrecruiters.com'])
  if (!sourceUrlValidation.ok || !applyUrlValidation.ok) return null

  return {
    sourceKey: source.key,
    externalId: detail.id,
    sourceUrl: sourceUrlValidation.url,
    applyUrl: applyUrlValidation.url,
    canonicalUrlHash: computeCanonicalUrlHash(sourceUrlValidation.url),
    title: detail.name.slice(0, 200),
    company: source.name,
    descriptionText,
    country: location.country,
    city: location.city,
    region: location.region,
    workMode: classification.workMode,
    internshipType: 'internship',
    isPfe: classification.isPfe,
    specialties: classification.specialties,
    technologies: classification.technologies,
    language: detectLanguage(descriptionText),
    publishedAt: parseReleasedDate(detail.releasedDate),
  }
}
