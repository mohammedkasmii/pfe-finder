import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = join(__dirname, '../../../supabase/migrations')

const cleanupMigration = readFileSync(join(MIGRATIONS_DIR, '20260914010400_cleanup_inactive_offers.sql'), 'utf8')
const seedMigration = readFileSync(join(MIGRATIONS_DIR, '20260914010500_seed_sources.sql'), 'utf8')
const canonicalMigration = readFileSync(join(MIGRATIONS_DIR, '20260914010600_offers_canonical_unique.sql'), 'utf8')
const grantsMigration = readFileSync(join(MIGRATIONS_DIR, '20260914010700_service_role_grants.sql'), 'utf8')
const finalizeMigration = readFileSync(join(MIGRATIONS_DIR, '20260914010800_finalize_ingestion_run.sql'), 'utf8')

describe('cleanup_inactive_offers migration (structural)', () => {
  it('revokes public/anon/authenticated access before granting execute only to service_role', () => {
    const revokeIndex = cleanupMigration.search(/^revoke all on function public\.cleanup_inactive_offers\(\) from public, anon, authenticated;$/m)
    const grantIndex = cleanupMigration.search(/^grant execute on function public\.cleanup_inactive_offers\(\) to service_role;$/m)
    expect(revokeIndex).toBeGreaterThan(-1)
    expect(grantIndex).toBeGreaterThan(-1)
    expect(grantIndex).toBeGreaterThan(revokeIndex)
  })
})

describe('seed_sources migration (structural)', () => {
  it('idempotently seeds exactly the three APPROVED_FOR_BUILD sources', () => {
    for (const key of ['smartrecruiters-inetum', 'smartrecruiters-devoteam', 'smartrecruiters-mazars']) {
      expect(seedMigration).toContain(key)
    }
    expect(seedMigration).toMatch(/on conflict \(key\) do update set/)
  })

  it('never overwrites `enabled` on conflict, so a manual disable survives re-seeding', () => {
    const updateSetClause = seedMigration.split(/on conflict \(key\) do update set/)[1]!
    expect(updateSetClause).not.toMatch(/\benabled\s*=/)
  })
})

describe('offers_canonical_unique migration (structural)', () => {
  it('adds a unique constraint on (source_key, canonical_url_hash)', () => {
    expect(canonicalMigration).toMatch(/unique \(source_key, canonical_url_hash\)/)
  })
})

describe('service_role_grants migration (structural)', () => {
  // Anchored to actual statement lines (start of line, no newlines inside
  // the exclusion class) so these can't accidentally match this file's
  // own explanatory prose (e.g. "Never GRANT ALL", "no extra grant is
  // needed... DELETE") the way an unanchored `[^;]*` would.
  const grantStatementLines = grantsMigration
    .split('\n')
    .filter((line) => /^grant\b/i.test(line.trim()))

  it('grants service_role only what the collector actually needs, never ALL PRIVILEGES', () => {
    expect(grantStatementLines.some((line) => /^grant all\b/i.test(line))).toBe(false)
    expect(grantsMigration).toMatch(/^grant select on public\.sources to service_role;$/m)
    expect(grantsMigration).toMatch(/^grant select, insert, update on public\.offers to service_role;$/m)
    expect(grantsMigration).toMatch(/^grant select, insert on public\.ingestion_runs to service_role;$/m)
  })

  it('never grants delete to service_role directly (deletes only happen via SECURITY DEFINER functions)', () => {
    expect(grantStatementLines.some((line) => /delete/i.test(line))).toBe(false)
  })
})

describe('finalize_ingestion_run migration (structural)', () => {
  it('defines both finalize functions with a fixed search_path and SECURITY DEFINER', () => {
    for (const fn of ['finalize_completed_run', 'finalize_failed_run']) {
      expect(finalizeMigration).toMatch(new RegExp(`create or replace function public\\.${fn}`))
    }
    // Anchored to a standalone statement line so this can't double-count
    // this file's own header comment, which also uses the phrase
    // "SECURITY DEFINER" in a sentence rather than as the SQL clause.
    const definerCount = (finalizeMigration.match(/^security definer$/gim) ?? []).length
    const searchPathCount = (finalizeMigration.match(/^set search_path = public$/gim) ?? []).length
    expect(definerCount).toBe(2)
    expect(searchPathCount).toBe(2)
  })

  it('revokes public/anon/authenticated access and grants execute only to service_role for both functions', () => {
    const revokeCount = (finalizeMigration.match(/revoke all on function[\s\S]*?from public, anon, authenticated/g) ?? [])
      .length
    const grantCount = (finalizeMigration.match(/grant execute on function[\s\S]*?to service_role/g) ?? []).length
    expect(revokeCount).toBe(2)
    expect(grantCount).toBe(2)
  })

  it('deactivates offers using a parameterized array containment check, not a string-built filter', () => {
    expect(finalizeMigration).toMatch(/external_id = any \(v_seen_ids\)/)
    // The header comment references the old `not.in.(...)` approach by
    // name to explain what this replaces — check only non-comment lines
    // for an actual (reintroduced) usage.
    const codeLines = finalizeMigration.split('\n').filter((line) => !line.trim().startsWith('--'))
    expect(codeLines.join('\n')).not.toMatch(/not\.in/)
  })

  // Splitting on the literal substring 'function public.finalize_X_run'
  // isolates each function's own CREATE...END;$$; body: the substring
  // occurs 4 times per function (create, comment, revoke, grant), so
  // `.split(...)[1]` is exactly the text between the create statement and
  // the next occurrence (the comment-on-function line) — the function
  // body and nothing else.
  const completedFnBody = finalizeMigration.split('function public.finalize_completed_run')[1]!
  const failedFnBody = finalizeMigration.split('function public.finalize_failed_run')[1]!

  it('finalize_failed_run never updates offers.status', () => {
    expect(failedFnBody).not.toMatch(/update public\.offers/)
  })

  it('both functions lock and validate a matching, still-running run before any mutation', () => {
    for (const body of [completedFnBody, failedFnBody]) {
      // The lock/validate select must run before the first mutating
      // statement in the function body.
      const lockIndex = body.search(/select id into v_locked_run_id[\s\S]*?for update;/)
      const firstUpdateIndex = body.search(/^\s*update public\./m)
      expect(lockIndex).toBeGreaterThan(-1)
      expect(firstUpdateIndex).toBeGreaterThan(-1)
      expect(lockIndex).toBeLessThan(firstUpdateIndex)
      expect(body).toMatch(/and status = 'running'/)
      expect(body).toMatch(/raise exception/)
    }
  })

  it('finalize_completed_run normalizes a null seen-ID array before using it in the deactivation predicate', () => {
    expect(completedFnBody).toMatch(/coalesce\(p_seen_external_ids, array\[\]::text\[\]\)/)
  })

  it('both functions assert exactly one sources/ingestion_runs row was updated', () => {
    const rowCountAssertions = (finalizeMigration.match(/if v_row_count <> 1 then/g) ?? []).length
    // finalize_completed_run asserts sources + ingestion_runs (2); finalize_failed_run asserts sources + ingestion_runs (2).
    expect(rowCountAssertions).toBe(4)
  })
})
