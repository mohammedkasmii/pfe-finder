#!/usr/bin/env node
/**
 * Fails if a production build (`.next/server` by default) contains any
 * trace of the Playwright-only test-fixture infrastructure that lives
 * under `e2e/test-server/` — the exact regression a real production
 * build shipped once: fixture flags, fake-client identifiers, fictional
 * company names/descriptions, and fixture offer IDs. Run this AFTER
 * `pnpm build` (see .github/workflows/ci.yml and README.md).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const TARGET_DIR = process.argv[2] ?? '.next/server'

// Kept in sync by hand with e2e/test-server/fixtures.mjs and
// server.mjs — anything here appearing in a production build is itself
// proof the test-only infrastructure leaked into the shipped bundle.
const FORBIDDEN_STRINGS = [
  'PFE_E2E_TEST_DATA',
  'createTestSupabaseClient',
  'runFakeSearchOffers',
  'TEST_OFFER_ROWS',
  'TEST_SOURCE_ROWS',
  'e2e-test-anon-key-not-a-real-credential',
  // Fictional company names from e2e/test-server/fixtures.mjs.
  'Atlas Software',
  'Rivage Analytics',
  'Cardinal Security',
  'Nimbus Cloud',
  'Meridian Networks',
  'Verity QA',
  'Solstice Systems',
  'Vector Labs',
  'Legacy Corp',
  // Fixture description text and id prefix.
  'Description de test générée',
  'aaaaaaaa-0000-4000-8000-',
]

const SKIPPED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.avif', '.woff', '.woff2', '.map'])

function listFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

function isSkippedExtension(filePath) {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) return false
  return SKIPPED_EXTENSIONS.has(filePath.slice(dot).toLowerCase())
}

function main() {
  let stat
  try {
    stat = statSync(TARGET_DIR)
  } catch {
    console.error(`scan-production-bundle: ${TARGET_DIR} does not exist — run "pnpm build" first.`)
    process.exit(1)
  }
  if (!stat.isDirectory()) {
    console.error(`scan-production-bundle: ${TARGET_DIR} is not a directory.`)
    process.exit(1)
  }

  const files = listFiles(TARGET_DIR).filter((f) => !isSkippedExtension(f))
  const findings = []

  for (const filePath of files) {
    let content
    try {
      content = readFileSync(filePath, 'utf8')
    } catch {
      continue // unreadable/binary — nothing to scan as text
    }
    for (const needle of FORBIDDEN_STRINGS) {
      if (content.includes(needle)) {
        findings.push({ file: filePath, needle })
      }
    }
  }

  if (findings.length > 0) {
    console.error('scan-production-bundle: found test-fixture content in the production bundle:')
    for (const { file, needle } of findings) {
      console.error(`  - ${file}: contains "${needle}"`)
    }
    process.exit(1)
  }

  console.log(`scan-production-bundle: ${files.length} files scanned under ${TARGET_DIR}, no fixture content found.`)
}

main()
