import { classifyPosting } from '../../ingestion/classification'
import { parseDateSafely } from '../../ingestion/dates'
import { sanitizeDescriptionToPlainText } from '../../ingestion/html'
import { detectLanguage } from '../../ingestion/language'
import type { NormalizedCandidate } from '../../ingestion/types'
import { computeCanonicalUrlHash, validateAllowlistedHttpsUrl } from '../../ingestion/urls'
import type { JoobleSourceConfig } from '../registry'
import type { JoobleJob } from './schema'

// Jooble's own `type` field, only trusted as an authoritative POSITIVE
// internship signal when it explicitly means internship/stage — never as a
// negative one (docs/HANDOFF.md M6A: Jooble's type taxonomy doesn't
// reliably distinguish seniority the way SmartRecruiters' experienceLevel
// does, so an unrecognized/absent type is left neutral, falling back to
// the shared classifier's own title-keyword check — same three-valued
// design as `src/lib/ingestion/classification.ts`'s experienceLevelId gate).
const JOOBLE_INTERNSHIP_TYPE = /\bstage\b|\bintern(ship)?\b/i

function isJoobleTypeInternship(type: string | undefined): boolean {
  return Boolean(type && JOOBLE_INTERNSHIP_TYPE.test(type))
}

// A location string that names only the country (or is empty/whitespace)
// carries no real city information — mapping it as a "city" would be a
// fabrication, not a conservative read of the source data.
const COUNTRY_ONLY_LOCATION_TOKENS = new Set(['maroc', 'morocco', 'ma'])
const MAX_CITY_LENGTH = 80

/**
 * Maps Jooble's single free-text `location` field to a city
 * conservatively: only the segment before the first comma, and only when
 * it isn't just the country's own name. Returns `null` whenever uncertain
 * rather than guessing (docs/HANDOFF.md M6A).
 */
function deriveCityFromLocation(location: string | undefined): string | null {
  if (!location) return null
  const firstSegment = location.split(',')[0]?.trim() ?? ''
  if (!firstSegment) return null
  if (COUNTRY_ONLY_LOCATION_TOKENS.has(firstSegment.toLowerCase())) return null
  return firstSegment.slice(0, MAX_CITY_LENGTH)
}

export function normalizeJoobleJob(job: JoobleJob, source: JoobleSourceConfig): NormalizedCandidate | null {
  const linkValidation = validateAllowlistedHttpsUrl(job.link, source.allowedHosts)
  if (!linkValidation.ok) return null

  const descriptionText = sanitizeDescriptionToPlainText(job.snippet ?? '')

  // Run every candidate through the same shared CS/PFE classifier every
  // other source uses — never weakened or bypassed for Jooble.
  const classification = classifyPosting({
    title: job.title,
    descriptionText,
    experienceLevelId: isJoobleTypeInternship(job.type) ? 'internship' : undefined,
  })
  if (!classification) return null

  return {
    sourceKey: source.key,
    externalId: job.id,
    sourceUrl: linkValidation.url,
    applyUrl: linkValidation.url,
    canonicalUrlHash: computeCanonicalUrlHash(linkValidation.url),
    title: job.title.slice(0, 200),
    company: job.company?.trim() || source.name,
    descriptionText,
    // This source is configured MA-only for M6A (docs/SOURCES.md) —
    // Jooble's own response never carries a separate structured country
    // field to normalize, so it's stamped from the source configuration
    // rather than parsed from free text.
    country: 'MA',
    city: deriveCityFromLocation(job.location),
    region: null,
    workMode: classification.workMode,
    internshipType: 'internship',
    isPfe: classification.isPfe,
    specialties: classification.specialties,
    technologies: classification.technologies,
    language: detectLanguage(descriptionText),
    publishedAt: parseDateSafely(job.updated),
  }
}
