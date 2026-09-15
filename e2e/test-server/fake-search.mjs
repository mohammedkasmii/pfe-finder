/**
 * In-memory mirror of `supabase/migrations/20260914020000_search_offers_function.sql`,
 * used only by the Playwright-only local test server (`server.mjs`) so
 * browser specs can exercise the real M3 filtering/sorting/pagination
 * behavior without a live Postgres instance or any real credentials.
 * Kept deliberately close to the SQL function's own semantics (same
 * filters, same sort keys, same keyset-pagination tuple comparison) — a
 * mirror of its design, not a reimplementation of a different one.
 */

function sortKeyOf(row, sort) {
  if (sort === 'recently-seen') return row.last_seen_at
  return row.published_at ?? row.first_seen_at
}

/** @param {object[]} rows @param {Record<string, unknown>} args */
export function runFakeSearchOffers(rows, args) {
  const query = args.p_query ? String(args.p_query).toLowerCase() : null
  const city = args.p_city ? String(args.p_city).toLowerCase() : null
  const sort = args.p_sort === 'recently-seen' ? 'recently-seen' : 'newest'
  const limit = args.p_limit && Number(args.p_limit) > 0 ? Math.min(Number(args.p_limit), 1000) : 13

  let filtered = rows.filter((row) => row.status === 'active')

  if (args.p_country) filtered = filtered.filter((row) => row.country === args.p_country)
  if (city) filtered = filtered.filter((row) => (row.city ?? '').toLowerCase().includes(city))
  if (args.p_specialty) filtered = filtered.filter((row) => row.specialties.includes(args.p_specialty))
  if (args.p_technology) filtered = filtered.filter((row) => row.technologies.includes(args.p_technology))
  if (args.p_work_mode) filtered = filtered.filter((row) => row.work_mode === args.p_work_mode)
  if (args.p_pfe !== null && args.p_pfe !== undefined) filtered = filtered.filter((row) => row.is_pfe === args.p_pfe)
  if (args.p_language) filtered = filtered.filter((row) => row.language === args.p_language)

  if (query) {
    filtered = filtered.filter((row) => {
      const haystack = [row.title, row.company, row.city ?? '', ...row.specialties, ...row.technologies]
      return haystack.some((value) => value.toLowerCase().includes(query))
    })
  }

  filtered = [...filtered].sort((a, b) => {
    const keyA = sortKeyOf(a, sort)
    const keyB = sortKeyOf(b, sort)
    if (keyA !== keyB) return keyA < keyB ? 1 : -1
    return a.id < b.id ? 1 : -1
  })

  if (args.p_cursor_value && args.p_cursor_id) {
    const cursorValue = args.p_cursor_value
    const cursorId = args.p_cursor_id
    filtered = filtered.filter((row) => {
      const key = sortKeyOf(row, sort)
      if (key === cursorValue) return row.id < cursorId
      return key < cursorValue
    })
  }

  return filtered.slice(0, limit)
}
