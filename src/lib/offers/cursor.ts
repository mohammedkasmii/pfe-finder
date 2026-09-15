import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { OFFERS_SORTS, type OffersSort } from './query-schema'

export interface CursorPayload {
  sort: OffersSort
  /** ISO datetime of the sort key (published/first-seen or last-seen). */
  value: string
  /** Offer UUID — the tiebreaker that keeps keyset pagination stable. */
  id: string
}

const CursorPayloadSchema = z.object({
  sort: z.enum(OFFERS_SORTS),
  value: z.iso.datetime(),
  id: z.uuid(),
})

const MAX_CURSOR_LENGTH = 512

function base64url(input: Buffer): string {
  return input.toString('base64url')
}

/**
 * Signs a cursor payload with HMAC-SHA256: `base64url(json).base64url(signature)`.
 * Opaque to the client — never decoded/trusted by anything other than
 * `verifyCursor` with the same secret.
 */
export function signCursor(payload: CursorPayload, secret: string): string {
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const signature = base64url(createHmac('sha256', secret).update(body).digest())
  return `${body}.${signature}`
}

/**
 * Verifies and decodes a cursor. Returns `null` — never throws — for any
 * tamper, bad signature, malformed base64url/JSON, wrong payload shape, or
 * over-length input, so a caller can treat "invalid" as one uniform case.
 */
export function verifyCursor(cursor: string, secret: string): CursorPayload | null {
  if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) return null

  const parts = cursor.split('.')
  if (parts.length !== 2) return null
  const [body, signature] = parts as [string, string]
  if (body.length === 0 || signature.length === 0) return null

  let expectedSignatureBuffer: Buffer
  let providedSignatureBuffer: Buffer
  try {
    expectedSignatureBuffer = createHmac('sha256', secret).update(body).digest()
    providedSignatureBuffer = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }

  // Length check first: timingSafeEqual throws on mismatched lengths
  // rather than returning false.
  if (expectedSignatureBuffer.length !== providedSignatureBuffer.length) return null
  if (!timingSafeEqual(expectedSignatureBuffer, providedSignatureBuffer)) return null

  let decodedJson: unknown
  try {
    decodedJson = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  const result = CursorPayloadSchema.safeParse(decodedJson)
  return result.success ? result.data : null
}
