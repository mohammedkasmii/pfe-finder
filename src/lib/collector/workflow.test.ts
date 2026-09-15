import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(join(__dirname, '../../../.github/workflows/collect.yml'), 'utf8')

describe('collect.yml', () => {
  it('never triggers on pull_request or pull_request_target', () => {
    expect(workflow).not.toMatch(/pull_request/)
  })

  it('declares minimal permissions', () => {
    expect(workflow).toMatch(/permissions:\s*\n\s*contents: read/)
  })

  it('pins every third-party action to a full commit SHA', () => {
    const usesLines = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!)
    expect(usesLines.length).toBeGreaterThan(0)
    for (const line of usesLines) {
      expect(line).toMatch(/@[0-9a-f]{40}/)
    }
  })

  it('runs on a daily schedule at 05:23 UTC and supports manual dispatch', () => {
    expect(workflow).toMatch(/cron:\s*'23 5 \* \* \*'/)
    expect(workflow).toMatch(/workflow_dispatch:/)
  })

  it('reads the ingestion credential only from GitHub Actions secrets', () => {
    expect(workflow).toMatch(/SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY\s*\}\}/)
  })

  it('reads JOOBLE_API_KEY only from GitHub Actions secrets, exactly once, in the Run collector step, never NEXT_PUBLIC_-prefixed (M6A)', () => {
    const matches = [...workflow.matchAll(/JOOBLE_API_KEY:\s*\$\{\{\s*secrets\.JOOBLE_API_KEY\s*\}\}/g)]
    expect(matches).toHaveLength(1)
    expect(workflow).not.toMatch(/NEXT_PUBLIC_JOOBLE_API_KEY/)
    // The single occurrence of the key name must fall after "Run collector"
    // and before the next step (there is no further step in this workflow).
    const runCollectorIndex = workflow.indexOf('Run collector')
    const joobleIndex = workflow.indexOf('JOOBLE_API_KEY')
    expect(joobleIndex).toBeGreaterThan(runCollectorIndex)
  })

  it('bounds job runtime with timeout-minutes', () => {
    expect(workflow).toMatch(/timeout-minutes:\s*\d+/)
  })

  it('prevents overlapping runs via a non-cancelling concurrency group', () => {
    expect(workflow).toMatch(/concurrency:\s*\n\s*group:\s*\S+/)
    expect(workflow).toMatch(/cancel-in-progress:\s*false/)
  })
})
