import { env } from '@/lib/env'
import { getPublicSupabaseClient } from '@/lib/db/public-client'
import { InvalidCursorError } from '@/lib/offers/errors'
import { OffersQuerySchema } from '@/lib/offers/query-schema'
import { searchOffers, type SearchOffersParams } from '@/lib/offers/search-offers'
import { getClientIp } from '@/lib/rate-limit/client-ip'
import { checkRateLimit } from '@/lib/rate-limit/limiter'

// Reads headers and does a per-request rate-limit check — must run at
// request time, never be statically prerendered.
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const ip = getClientIp(request.headers)
  const { allowed } = await checkRateLimit(`offers:${ip}`)
  if (!allowed) {
    return Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  const url = new URL(request.url)
  // `Object.fromEntries(url.searchParams)` silently keeps only the LAST
  // value of a repeated key (e.g. `?country=MA&country=FR`) — the M3
  // review flagged this as a way to smuggle a second value past casual
  // inspection. Reject any repeated key outright before it ever reaches
  // that collapsing step.
  const keys = [...url.searchParams.keys()]
  if (new Set(keys).size !== keys.length) {
    return Response.json({ error: 'invalid_query' }, { status: 400 })
  }

  const parseResult = OffersQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parseResult.success) {
    return Response.json({ error: 'invalid_query' }, { status: 400 })
  }

  const query = parseResult.data
  const params: SearchOffersParams = {
    q: query.q,
    country: query.country,
    city: query.city,
    specialty: query.specialty,
    technology: query.technology,
    workMode: query.workMode,
    pfe: query.pfe,
    language: query.language,
    sort: query.sort,
    cursor: query.cursor,
    limit: query.limit,
  }

  try {
    const client = getPublicSupabaseClient()
    const result = await searchOffers(client, params, { cursorSecret: env.cursorSecret })
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      return Response.json({ error: 'invalid_cursor' }, { status: 400 })
    }
    // Never leak a database error, connection string, or stack trace
    // (docs/SECURITY.md: "never expose database errors").
    return Response.json({ error: 'service_unavailable' }, { status: 503 })
  }
}
