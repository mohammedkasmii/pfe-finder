import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const rlsMigration = readFileSync(
  join(__dirname, '../../../supabase/migrations/20260914010300_rls.sql'),
  'utf8',
)

describe('RLS migration (structural)', () => {
  it('enables row level security on every public table', () => {
    for (const table of ['sources', 'offers', 'ingestion_runs']) {
      expect(rlsMigration).toMatch(new RegExp(`alter table public\\.${table} enable row level security`))
    }
  })

  it('never grants insert, update, or delete to anon or authenticated', () => {
    expect(rlsMigration).not.toMatch(/grant\s+(insert|update|delete|all)\s+on[\s\S]*?to\s+(anon|authenticated)/i)
  })

  it('restricts the offers policy to active status', () => {
    expect(rlsMigration).toMatch(/using \(status = 'active'\)/)
  })

  it('grants sources columns explicitly and excludes internal configuration', () => {
    const grantMatch = rlsMigration.match(/grant select \(([^)]+)\)\s+on public\.sources to anon/)
    expect(grantMatch).not.toBeNull()
    const grantedColumns = grantMatch![1]!.split(',').map((c) => c.trim())
    expect(grantedColumns).toEqual(
      expect.arrayContaining(['key', 'name', 'countries', 'enabled', 'last_success_at', 'attribution_url']),
    )
    for (const forbidden of ['employer_identifier', 'allowed_hosts', 'adapter', 'last_error_at']) {
      expect(grantedColumns).not.toContain(forbidden)
    }
  })

  it('grants ingestion_runs no anon/authenticated access at all', () => {
    expect(rlsMigration).not.toMatch(/grant[\s\S]*?on public\.ingestion_runs[\s\S]*?to\s+(anon|authenticated)/i)
  })

  it('revokes default privileges from anon and authenticated up front', () => {
    expect(rlsMigration).toMatch(/revoke all on public\.sources from anon, authenticated/)
    expect(rlsMigration).toMatch(/revoke all on public\.offers from anon, authenticated/)
    expect(rlsMigration).toMatch(/revoke all on public\.ingestion_runs from anon, authenticated/)
  })
})
