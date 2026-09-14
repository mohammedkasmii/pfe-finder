import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const cleanupMigration = readFileSync(
  join(__dirname, '../../../supabase/migrations/20260914010400_cleanup_inactive_offers.sql'),
  'utf8',
)

describe('cleanup_inactive_offers migration (structural)', () => {
  it('only deletes inactive offers', () => {
    expect(cleanupMigration).toMatch(/delete from public\.offers/)
    expect(cleanupMigration).toMatch(/where status = 'inactive'/)
  })

  it('enforces the documented 30-day retention window', () => {
    expect(cleanupMigration).toMatch(/inactive_at < now\(\) - interval '30 days'/)
  })

  it('revokes execute access from anon, authenticated, and public', () => {
    expect(cleanupMigration).toMatch(
      /revoke all on function public\.cleanup_inactive_offers\(\) from public, anon, authenticated/,
    )
  })
})
