/**
 * Thrown by `searchOffers` only when a caller-supplied cursor fails
 * signature/shape verification (bad signature, tampered, malformed). A
 * cursor that verifies but whose `sort` doesn't match the current
 * request is NOT an error — it's silently treated as absent (see
 * search-offers.ts). The route handler maps this to a 400.
 */
export class InvalidCursorError extends Error {
  constructor() {
    super('invalid or tampered cursor')
    this.name = 'InvalidCursorError'
  }
}

/**
 * Wraps a database failure with a fixed, bounded message — mirrors
 * src/lib/db/errors.ts's IngestionDbError. Never interpolates the raw
 * `cause` into `.message`; kept only as `.cause` for local debugging,
 * never surfaced to the API response (src/app/api/offers/route.ts maps
 * any non-InvalidCursorError to a generic 503 regardless of message).
 */
export class SearchOffersError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'SearchOffersError'
    this.cause = cause
  }
}

/**
 * Thrown by `getOfferById` for a genuine database/configuration failure —
 * distinct from returning `null`, which means "malformed id" or
 * "genuinely no matching active row" (both correctly become a 404). A
 * caller must render the translated service-error state for this, never
 * treat it as not-found (docs/HANDOFF.md M3 review finding 4: "a database
 * error becomes a false 404" was the exact bug this type prevents).
 */
export class GetOfferError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'GetOfferError'
    this.cause = cause
  }
}
