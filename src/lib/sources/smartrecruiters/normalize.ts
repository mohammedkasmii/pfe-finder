import { classifyPosting } from '../../ingestion/classification'
import { parseDateSafely } from '../../ingestion/dates'
import { sanitizeDescriptionToPlainText } from '../../ingestion/html'
import { detectLanguage } from '../../ingestion/language'
import { normalizeLocation } from '../../ingestion/location'
import type { NormalizedCandidate } from '../../ingestion/types'
import { computeCanonicalUrlHash, validateAllowlistedHttpsUrl } from '../../ingestion/urls'
import type { SmartRecruitersSourceConfig } from '../registry'
import type { SmartRecruitersDetailResponse } from './schema'

export function normalizeSmartRecruitersPosting(
  detail: SmartRecruitersDetailResponse,
  source: SmartRecruitersSourceConfig,
): NormalizedCandidate | null {
  const descriptionHtml = [
    detail.jobAd?.sections?.jobDescription?.text,
    detail.jobAd?.sections?.qualifications?.text,
  ]
    .filter((text): text is string => Boolean(text))
    .join('\n')
  const descriptionText = sanitizeDescriptionToPlainText(descriptionHtml)

  const classification = classifyPosting({
    title: detail.name,
    descriptionText,
    experienceLevelId: detail.experienceLevel?.id,
  })
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
    publishedAt: parseDateSafely(detail.releasedDate),
  }
}
