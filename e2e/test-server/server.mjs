#!/usr/bin/env node
/**
 * A minimal, Playwright-only local HTTP server shaped just enough like
 * Supabase's PostgREST REST API for the real app's own Supabase client
 * to talk to it unmodified. Started as a separate `webServer` entry in
 * `playwright.config.ts`; the Next.js app under test is pointed at it
 * via `NEXT_PUBLIC_SUPABASE_URL` (see that config's second webServer
 * entry) — so `src/lib/db/public-client.ts` needs no test-mode branch,
 * flag, or import at all (M3 review: the previous approach imported a
 * fake client and fictional fixture data directly into the production
 * runtime import graph).
 *
 * Implements exactly the three call shapes the app's own code uses
 * (confirmed empirically against a real `@supabase/supabase-js` client
 * during development of this server — see docs/HANDOFF.md):
 *   - GET  /rest/v1/sources?select=...&enabled=eq.true
 *   - GET  /rest/v1/offers?select=*&id=eq.<uuid>&status=eq.active
 *   - POST /rest/v1/rpc/search_offers   (JSON body = the RPC args)
 * All three respond with a bare JSON array — supabase-js's own
 * `.maybeSingle()` unwraps a one-element (or empty) array client-side,
 * no PostgREST content-negotiation headers required.
 */
import { createServer } from 'node:http'
import { runFakeSearchOffers } from './fake-search.mjs'
import { TEST_OFFER_ROWS, TEST_SOURCE_ROWS } from './fixtures.mjs'

const PORT = Number(process.env.PORT ?? 54321)

function parseEqFilters(searchParams) {
  const filters = {}
  for (const [key, value] of searchParams.entries()) {
    if (key === 'select') continue
    if (value.startsWith('eq.')) filters[key] = value.slice(3)
  }
  return filters
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) })
  res.end(json)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  if (req.method === 'GET' && url.pathname === '/rest/v1/sources') {
    const filters = parseEqFilters(url.searchParams)
    const rows = TEST_SOURCE_ROWS.filter((row) => (filters.enabled === undefined ? true : String(row.enabled) === filters.enabled))
    sendJson(res, 200, rows)
    return
  }

  if (req.method === 'GET' && url.pathname === '/rest/v1/offers') {
    const filters = parseEqFilters(url.searchParams)
    const rows = TEST_OFFER_ROWS.filter((row) => {
      if (filters.id !== undefined && row.id !== filters.id) return false
      if (filters.status !== undefined && row.status !== filters.status) return false
      return true
    })
    sendJson(res, 200, rows)
    return
  }

  if (req.method === 'POST' && url.pathname === '/rest/v1/rpc/search_offers') {
    try {
      const raw = await readBody(req)
      const args = raw ? JSON.parse(raw) : {}
      const rows = runFakeSearchOffers(TEST_OFFER_ROWS, args)
      sendJson(res, 200, rows)
    } catch (error) {
      sendJson(res, 400, { message: `test-server: malformed rpc body: ${error instanceof Error ? error.message : 'unknown'}` })
    }
    return
  }

  sendJson(res, 404, { message: `test-server: unhandled route ${req.method} ${url.pathname}` })
})

server.listen(PORT, () => {
  console.log(`e2e PostgREST-shaped test server listening on http://127.0.0.1:${PORT}`)
})
