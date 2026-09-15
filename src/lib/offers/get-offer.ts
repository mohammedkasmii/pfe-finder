import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { GetOfferError } from './errors'
import { toPublicOfferDetail, type OfferDbRow, type PublicOfferDetail } from './public-offer'

const uuidSchema = z.uuid()

/**
 * Backs `/offers/{uuid}` (docs/ARCHITECTURE.md: "Stable detail pages use
 * `/offers/{uuid}` and return 404 for inactive or missing offers").
 *
 * `getClient` is a FACTORY, not an already-built client: the id is
 * validated before it's ever called, so a malformed id never constructs
 * a Supabase client at all (M3 review finding 4 — the previous signature
 * took a pre-built client, which meant `getPublicSupabaseClient()` had
 * already run, and could already throw, before this function got a
 * chance to short-circuit on a bad id). Returns `null` for "malformed
 * id" and "well-formed id but no matching active row" alike — both are
 * genuinely a 404. A database/configuration failure instead THROWS
 * `GetOfferError` (bounded message, raw cause never in `.message`) so a
 * caller can render the distinct service-error state rather than a false
 * 404.
 */
export async function getOfferById(getClient: () => SupabaseClient, rawId: string): Promise<PublicOfferDetail | null> {
  const idResult = uuidSchema.safeParse(rawId)
  if (!idResult.success) return null

  let client: SupabaseClient
  try {
    client = getClient()
  } catch (cause) {
    throw new GetOfferError('failed to construct database client', cause)
  }

  const { data, error } = await client
    .from('offers')
    .select('*')
    .eq('id', idResult.data)
    .eq('status', 'active')
    .maybeSingle()

  if (error) throw new GetOfferError('failed to fetch offer', error)
  if (!data) return null

  return toPublicOfferDetail(data as OfferDbRow)
}
