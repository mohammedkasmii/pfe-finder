import { validateAllowlistedHttpsUrl } from '../ingestion/urls'
import { SOURCE_REGISTRY } from '../sources/registry'
import type { SpecialtySlug } from '../ingestion/dictionaries/specialties'

/** Raw shape of a row returned by `public.search_offers` or a direct `offers` select. */
export interface OfferDbRow {
  id: string
  source_key: string
  external_id: string
  source_url: string
  apply_url: string
  canonical_url_hash: string
  title: string
  company: string
  description_text: string
  country: 'MA' | 'FR'
  city: string | null
  region: string | null
  work_mode: 'onsite' | 'hybrid' | 'remote' | 'unknown'
  internship_type: 'internship'
  is_pfe: boolean
  specialties: string[]
  technologies: string[]
  language: 'fr' | 'en'
  published_at: string | null
  first_seen_at: string
  last_seen_at: string
  inactive_at: string | null
  status: 'active' | 'inactive'
  created_at: string
  updated_at: string
}

export interface PublicOfferSummary {
  id: string
  title: string
  company: string
  country: 'MA' | 'FR'
  city: string | null
  region: string | null
  workMode: 'onsite' | 'hybrid' | 'remote' | 'unknown'
  isPfe: boolean
  specialties: SpecialtySlug[]
  technologies: string[]
  language: 'fr' | 'en'
  publishedAt: string | null
  sourceName: string
  attributionUrl: string
}

export interface PublicOfferDetail extends PublicOfferSummary {
  descriptionText: string
  sourceUrl: string | null
  applyUrl: string | null
  lastSeenAt: string
}

const UNKNOWN_SOURCE_NAME = 'Independent source'
const UNKNOWN_SOURCE_ATTRIBUTION_URL = 'https://jobs.smartrecruiters.com'

function resolveSource(sourceKey: string) {
  return SOURCE_REGISTRY.find((source) => source.key === sourceKey)
}

/**
 * Public, explicitly-enumerated field allowlist — no `...row` spreads, so a
 * new internal DB column added later can never leak through this boundary
 * by default (docs/ARCHITECTURE.md: "Each public item excludes internal
 * errors and ingestion metadata").
 */
export function toPublicOfferSummary(row: OfferDbRow): PublicOfferSummary {
  const source = resolveSource(row.source_key)
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    country: row.country,
    city: row.city,
    region: row.region,
    workMode: row.work_mode,
    isPfe: row.is_pfe,
    specialties: row.specialties as SpecialtySlug[],
    technologies: row.technologies,
    language: row.language,
    publishedAt: row.published_at,
    sourceName: source?.name ?? UNKNOWN_SOURCE_NAME,
    attributionUrl: source?.attributionUrl ?? UNKNOWN_SOURCE_ATTRIBUTION_URL,
  }
}

/**
 * Re-validates the offer's own source/apply URLs against that SPECIFIC
 * source's allowed hosts before ever handing them to the UI to render —
 * never trusts that ingestion validated them correctly (or still would,
 * if the source's allowlist changed since). A failure maps the field to
 * `null` rather than throwing, so the detail page can hide an unsafe or
 * stale link instead of rendering one.
 */
export function toPublicOfferDetail(row: OfferDbRow): PublicOfferDetail {
  const summary = toPublicOfferSummary(row)
  const source = resolveSource(row.source_key)
  const allowedHosts = source?.allowedHosts ?? []

  const sourceUrlCheck = allowedHosts.length > 0 ? validateAllowlistedHttpsUrl(row.source_url, allowedHosts) : null
  const applyUrlCheck = allowedHosts.length > 0 ? validateAllowlistedHttpsUrl(row.apply_url, allowedHosts) : null

  return {
    ...summary,
    descriptionText: row.description_text,
    sourceUrl: sourceUrlCheck?.ok ? sourceUrlCheck.url : null,
    applyUrl: applyUrlCheck?.ok ? applyUrlCheck.url : null,
    lastSeenAt: row.last_seen_at,
  }
}
