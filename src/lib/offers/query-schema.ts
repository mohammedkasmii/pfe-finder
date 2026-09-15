import { z } from 'zod'
import { SPECIALTY_SLUGS } from '../ingestion/dictionaries/specialties'

export const OFFERS_SORTS = ['newest', 'recently-seen'] as const
export type OffersSort = (typeof OFFERS_SORTS)[number]

export const DEFAULT_OFFERS_LIMIT = 12
export const MAX_OFFERS_LIMIT = 24
export const MAX_CURSOR_LENGTH = 512

const qSchema = z.string().trim().min(1).max(100)
const countrySchema = z.enum(['MA', 'FR'])
const citySchema = z.string().trim().min(1).max(80)
const specialtySchema = z.enum(SPECIALTY_SLUGS)
const technologySchema = z.string().trim().min(1).max(40)
const workModeSchema = z.enum(['onsite', 'hybrid', 'remote', 'unknown'])
// The API surface only ever accepts the literal "true" or omission — there
// is no "false" value: pfe is a narrowing filter, never a "PFE only when
// false" inversion.
const pfeSchema = z.literal('true').transform(() => true as const)
const languageSchema = z.enum(['fr', 'en'])
const sortSchema = z.enum(OFFERS_SORTS)
const cursorSchema = z.string().trim().min(1).max(MAX_CURSOR_LENGTH)
const limitSchema = z.coerce.number().int().min(1).max(MAX_OFFERS_LIMIT)

/**
 * Strict schema for `GET /api/offers` (docs/ARCHITECTURE.md § Application
 * interfaces). Any oversized/malformed/wrong-type field fails the whole
 * parse — the route handler turns that into a controlled 400. Never used
 * for the `/offers` page itself, which must tolerate and normalize bad
 * URL state instead (see `normalizeOffersSearchParams` below).
 */
export const OffersQuerySchema = z
  .object({
    q: qSchema.optional(),
    country: countrySchema.optional(),
    city: citySchema.optional(),
    specialty: specialtySchema.optional(),
    technology: technologySchema.optional(),
    workMode: workModeSchema.optional(),
    pfe: pfeSchema.optional(),
    language: languageSchema.optional(),
    sort: sortSchema.default('newest'),
    cursor: cursorSchema.optional(),
    limit: limitSchema.default(DEFAULT_OFFERS_LIMIT),
  })
  // .strict(): an unknown key (e.g. `?admin=true`) fails the whole parse
  // instead of being silently stripped — the M3 review found
  // `?country=MA&admin=true` reached the data layer. The default
  // `z.object` behavior strips unrecognized keys rather than rejecting
  // them, which is wrong at a validated API boundary.
  .strict()
export type OffersQuery = z.infer<typeof OffersQuerySchema>

type RawSearchParams = URLSearchParams | Record<string, string | string[] | undefined>

function firstValue(params: RawSearchParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) {
    return params.get(key) ?? undefined
  }
  const value = params[key]
  if (Array.isArray(value)) return value[0]
  return value
}

export interface NormalizedOffersQuery {
  query: OffersQuery
  ignoredKeys: string[]
}

/**
 * Lenient counterpart for the `/offers` server page: a URL a visitor
 * bookmarked, shared, or hand-edited must never crash the page or wipe
 * every other filter just because one value is stale/invalid — each field
 * is validated independently, a bad one is silently dropped (or reset to
 * its default for `sort`/`limit`, which always need a concrete value),
 * and every dropped key is reported in `ignoredKeys` so the page can show
 * a one-line notice.
 */
export function normalizeOffersSearchParams(params: RawSearchParams): NormalizedOffersQuery {
  const ignoredKeys: string[] = []

  function normalize<T>(key: string, schema: z.ZodType<T>): T | undefined {
    const raw = firstValue(params, key)
    if (raw === undefined) return undefined
    const result = schema.safeParse(raw)
    if (result.success) return result.data
    ignoredKeys.push(key)
    return undefined
  }

  const sort = normalize('sort', sortSchema) ?? 'newest'
  const limit = normalize('limit', limitSchema) ?? DEFAULT_OFFERS_LIMIT

  const query: OffersQuery = {
    q: normalize('q', qSchema),
    country: normalize('country', countrySchema),
    city: normalize('city', citySchema),
    specialty: normalize('specialty', specialtySchema),
    technology: normalize('technology', technologySchema),
    workMode: normalize('workMode', workModeSchema),
    pfe: normalize('pfe', pfeSchema),
    language: normalize('language', languageSchema),
    sort,
    cursor: normalize('cursor', cursorSchema),
    limit,
  }

  return { query, ignoredKeys }
}
