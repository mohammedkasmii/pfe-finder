#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isForbiddenFile, scanContent } from './lib/secret-scan.mjs'

// Binary/media formats never need a text scan and can legitimately contain
// byte sequences that look like matches above.
const SKIPPED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.zip',
])

// Files whose entire purpose is holding synthetic, non-functional examples
// of the exact patterns this scanner looks for (fake AWS key IDs, a fake
// PEM header, ...), used to unit-test the detector itself. Exempting them
// by exact path — never a broad "*.test.*" glob — keeps every other test
// file covered by the scan.
const SELF_TEST_FIXTURES = new Set(['scripts/lib/secret-scan.test.mjs'])

function listCandidateFiles() {
  // Tracked + untracked-but-not-gitignored files, so a stray secret file
  // that hasn't been `git add`-ed yet is still caught before it can be
  // committed.
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  })
  return output.split('\n').filter(Boolean)
}

function isSkippedExtension(filePath) {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) return false
  return SKIPPED_EXTENSIONS.has(filePath.slice(dot).toLowerCase())
}

function main() {
  const files = listCandidateFiles()
  const findings = []

  for (const filePath of files) {
    if (SELF_TEST_FIXTURES.has(filePath.split('\\').join('/'))) continue
    if (isForbiddenFile(filePath)) {
      findings.push({ file: filePath, rule: 'forbidden environment file tracked by git' })
      continue
    }
    if (isSkippedExtension(filePath)) continue

    let content
    try {
      content = readFileSync(filePath, 'utf8')
    } catch {
      continue // unreadable or binary — nothing to scan as text
    }
    findings.push(...scanContent(content, filePath))
  }

  if (findings.length > 0) {
    console.error('scan:secrets found potential issues:')
    for (const finding of findings) {
      console.error(`  - ${finding.file}: ${finding.rule}`)
    }
    process.exitCode = 1
    return
  }

  console.log(`scan:secrets: ${files.length} files scanned, no issues found.`)
}

main()
