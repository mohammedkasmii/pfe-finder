import { z } from 'zod'
import { SPECIALTY_SLUGS } from './dictionaries/specialties'

export const CountrySchema = z.enum(['MA', 'FR'])
export const WorkModeSchema = z.enum(['onsite', 'hybrid', 'remote', 'unknown'])
export const LanguageSchema = z.enum(['fr', 'en'])
export const SpecialtySlugSchema = z.enum(SPECIALTY_SLUGS)

/**
 * A single, source-agnostic normalized candidate — the boundary between
 * per-source adapters (SmartRecruiters, etc.) and the collector
 * orchestration. Shape/bounds validation only: HTTPS-and-allowlist
 * enforcement happens earlier, in `validateAllowlistedHttpsUrl`
 * (src/lib/ingestion/urls.ts), before a candidate is ever constructed.
 */
export const NormalizedCandidateSchema = z.object({
  sourceKey: z.string().min(1),
  externalId: z.string().min(1).max(200),
  sourceUrl: z.url(),
  applyUrl: z.url(),
  canonicalUrlHash: z.string().min(1),
  title: z.string().min(1).max(200),
  company: z.string().min(1).max(200),
  descriptionText: z.string().max(5000),
  country: CountrySchema,
  city: z.string().max(80).nullable(),
  region: z.string().max(80).nullable(),
  workMode: WorkModeSchema,
  internshipType: z.literal('internship'),
  isPfe: z.boolean(),
  specialties: z.array(SpecialtySlugSchema),
  technologies: z.array(z.string().max(40)),
  language: LanguageSchema,
  publishedAt: z.iso.datetime().nullable(),
})
export type NormalizedCandidate = z.infer<typeof NormalizedCandidateSchema>

export interface CollectionResult {
  sourceKey: string
  candidates: NormalizedCandidate[]
  fetchedCount: number
  acceptedCount: number
  rejectedCount: number
  scanComplete: boolean
  errorSummary?: string
}

/**
 * Top-level shape check for an adapter's raw result, used at the actual
 * runtime boundary (src/lib/ingestion/validate-collection-result.ts)
 * before persistence. `candidates` is deliberately typed as `unknown[]`
 * here: each element is re-validated individually against
 * `NormalizedCandidateSchema` so one malformed candidate can be dropped
 * without invalidating the whole result.
 */
export const CollectionResultSchema = z.object({
  sourceKey: z.string().min(1),
  candidates: z.array(z.unknown()),
  fetchedCount: z.number().int().nonnegative(),
  acceptedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  scanComplete: z.boolean(),
  errorSummary: z.string().optional(),
})
