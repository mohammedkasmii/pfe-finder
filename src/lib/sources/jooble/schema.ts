import { z } from 'zod'

/**
 * Shapes for Jooble's public REST Search API
 * (https://jooblehelpcenter.freshdesk.com/en/support/solutions/articles/60001448238-rest-api-documentation).
 * Every external field is treated as untrusted (docs/SECURITY.md):
 * required fields are strictly typed, everything else is optional so an
 * upstream field we don't use yet can't break validation, and nothing here
 * is trusted for anything beyond shape/bounds — normalization and
 * classification apply their own rules on top
 * (src/lib/sources/jooble/normalize.ts).
 *
 * Every string field also carries a practical maximum length: a real
 * Jooble response is small and bounded, so a field far outside that range
 * is itself a signal of a malformed or hostile response and is rejected
 * here — at the schema boundary — rather than silently accepted.
 */
const MAX_ID_LENGTH = 200
const MAX_TITLE_LENGTH = 500
const MAX_COMPANY_LENGTH = 500
const MAX_LOCATION_LENGTH = 300
const MAX_SNIPPET_LENGTH = 20_000
const MAX_URL_LENGTH = 2048
const MAX_TYPE_LENGTH = 100
const MAX_UPDATED_LENGTH = 64
// The collector always requests ResultOnPage=50 (docs/SOURCES.md); a
// response reporting far more items than that in one page is itself a
// signal of a malformed/hostile response, not a legitimate result set.
const MAX_JOBS_PER_PAGE = 200

// Jooble's official REST API documentation returns `jobs[].id` as a JSON
// number (its example response is unquoted); some responses observed in
// practice return it as a string instead. Accept exactly those two
// representations — never `z.coerce.string()`, which would silently accept
// unrelated values like booleans, objects, or null — and transform either
// into one canonical string at this schema boundary, so every downstream
// consumer (deduplication by ID, `externalId`, normalization) only ever
// sees a string, unchanged from before this fix.
const JoobleJobIdSchema = z
  .union([
    z.string().min(1).max(MAX_ID_LENGTH),
    // Number.isSafeInteger rejects fractional, non-finite (NaN/Infinity),
    // and unsafe-range numbers in one check; `n >= 0` rejects negative IDs.
    z.number().refine((n) => Number.isSafeInteger(n) && n >= 0, {
      message: 'must be a nonnegative safe integer',
    }),
  ])
  .transform((value) => String(value))

/**
 * Production incident (docs/HANDOFF.md M6A): real Jooble job records return
 * explicit JSON `null` for optional fields the documentation presents as
 * strings — `z.string().optional()` alone only tolerates a MISSING key,
 * not an explicit `null` value, so every such record failed
 * `JoobleSearchResponseSchema` entirely and the whole scan errored with no
 * offers imported. Accepts a bounded string, `null`, or absence, and
 * transforms `null` to `undefined` at this schema boundary so every
 * downstream consumer (`JoobleJob`'s inferred type, normalization) keeps
 * seeing exactly `string | undefined` as before — never broadened to
 * accept any other type, and never `z.coerce.string()`.
 */
function nullableOptionalString(maxLength: number) {
  return z
    .string()
    .max(maxLength)
    .nullable()
    .optional()
    .transform((value) => value ?? undefined)
}

export const JoobleJobSchema = z.object({
  id: JoobleJobIdSchema,
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
  location: nullableOptionalString(MAX_LOCATION_LENGTH),
  snippet: nullableOptionalString(MAX_SNIPPET_LENGTH),
  type: nullableOptionalString(MAX_TYPE_LENGTH),
  link: z.url().max(MAX_URL_LENGTH),
  company: nullableOptionalString(MAX_COMPANY_LENGTH),
  updated: nullableOptionalString(MAX_UPDATED_LENGTH),
})
export type JoobleJob = z.infer<typeof JoobleJobSchema>

export const JoobleSearchResponseSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  jobs: z.array(JoobleJobSchema).max(MAX_JOBS_PER_PAGE),
})
export type JoobleSearchResponse = z.infer<typeof JoobleSearchResponseSchema>
