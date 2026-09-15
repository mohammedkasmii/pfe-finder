import { z } from 'zod'

/**
 * Shapes for SmartRecruiters' public Posting API (v1). Every external
 * field is treated as untrusted (docs/SECURITY.md): required fields are
 * strictly typed, everything else is optional so an upstream field we
 * don't use yet can't break validation, and nothing here is trusted for
 * anything beyond shape/bounds — normalization and classification apply
 * their own rules on top (src/lib/sources/smartrecruiters/normalize.ts).
 *
 * Every string/array field also carries a practical maximum length/size:
 * a real SmartRecruiters response is small and bounded, so a field far
 * outside that range is itself a signal of a malformed or hostile
 * response and is rejected here — at the schema boundary — rather than
 * silently accepted and only bounded later by an ad hoc `.slice()`
 * downstream.
 */
const MAX_ID_LENGTH = 200
const MAX_NAME_LENGTH = 500
const MAX_LOCATION_FIELD_LENGTH = 200
const MAX_URL_LENGTH = 2048
const MAX_SECTION_TEXT_LENGTH = 50_000
const MAX_DATE_STRING_LENGTH = 64
const MAX_LISTING_PAGE_SIZE = 500
const MAX_ENUM_ID_LENGTH = 100

/**
 * A small `{ id, ... }` enum-shaped field from SmartRecruiters' Posting
 * API — `experienceLevel` and `typeOfEmployment` share this shape. Bounded
 * and fully optional: absence is a normal, common case (docs/HANDOFF.md
 * classification correction), not a schema violation.
 */
const ProviderMetadataFieldSchema = z
  .object({
    id: z.string().max(MAX_ENUM_ID_LENGTH).optional(),
  })
  .partial()

const LocationSchema = z
  .object({
    city: z.string().max(MAX_LOCATION_FIELD_LENGTH).optional(),
    region: z.string().max(MAX_LOCATION_FIELD_LENGTH).optional(),
    country: z.string().max(MAX_LOCATION_FIELD_LENGTH).optional(),
    remote: z.boolean().optional(),
  })
  .partial()

export const SmartRecruitersListingItemSchema = z.object({
  id: z.string().min(1).max(MAX_ID_LENGTH),
  name: z.string().min(1).max(MAX_NAME_LENGTH),
})
export type SmartRecruitersListingItem = z.infer<typeof SmartRecruitersListingItemSchema>

export const SmartRecruitersListingResponseSchema = z.object({
  totalFound: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  content: z.array(SmartRecruitersListingItemSchema).max(MAX_LISTING_PAGE_SIZE),
})
export type SmartRecruitersListingResponse = z.infer<typeof SmartRecruitersListingResponseSchema>

const JobAdSectionSchema = z
  .object({
    title: z.string().max(MAX_NAME_LENGTH).optional(),
    text: z.string().max(MAX_SECTION_TEXT_LENGTH).optional(),
  })
  .partial()

export const SmartRecruitersDetailResponseSchema = z.object({
  id: z.string().min(1).max(MAX_ID_LENGTH),
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  applyUrl: z.url().max(MAX_URL_LENGTH).optional(),
  releasedDate: z.string().max(MAX_DATE_STRING_LENGTH).optional(),
  location: LocationSchema.optional(),
  // Trusted, normalized provider metadata the classifier uses as a
  // reliable, non-inferred signal (docs/HANDOFF.md classification
  // correction): `experienceLevel.id` distinguishes a genuine internship
  // from a permanent/senior role whose qualifications merely mention
  // prior internship experience in free text. `typeOfEmployment` is
  // preserved for the same reason it appears in real responses, but is
  // deliberately NOT used to reject a posting on its own.
  experienceLevel: ProviderMetadataFieldSchema.optional(),
  typeOfEmployment: ProviderMetadataFieldSchema.optional(),
  jobAd: z
    .object({
      sections: z
        .object({
          jobDescription: JobAdSectionSchema.optional(),
          qualifications: JobAdSectionSchema.optional(),
        })
        .partial()
        .optional(),
    })
    .optional(),
})
export type SmartRecruitersDetailResponse = z.infer<typeof SmartRecruitersDetailResponseSchema>
