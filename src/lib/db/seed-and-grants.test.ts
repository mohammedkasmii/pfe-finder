import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = join(__dirname, '../../../supabase/migrations')

const cleanupMigration = readFileSync(join(MIGRATIONS_DIR, '20260914010400_cleanup_inactive_offers.sql'), 'utf8')
const seedMigration = readFileSync(join(MIGRATIONS_DIR, '20260914010500_seed_sources.sql'), 'utf8')
const canonicalMigration = readFileSync(join(MIGRATIONS_DIR, '20260914010600_offers_canonical_unique.sql'), 'utf8')
const grantsMigration = readFileSync(join(MIGRATIONS_DIR, '20260914010700_service_role_grants.sql'), 'utf8')
const finalizeMigration = readFileSync(join(MIGRATIONS_DIR, '20260914010800_finalize_ingestion_run.sql'), 'utf8')
const searchOffersMigration = readFileSync(join(MIGRATIONS_DIR, '20260914020000_search_offers_function.sql'), 'utf8')
const m6aSourcesMigration = readFileSync(
  join(MIGRATIONS_DIR, '20260916010000_m6a_jooble_and_wavestone_sources.sql'),
  'utf8',
)

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

describe('M6A jooble/wavestone sources migration (structural)', () => {
  it('idempotently inserts exactly the two new M6A source keys', () => {
    for (const key of ['jooble-morocco', 'smartrecruiters-wavestone']) {
      expect(m6aSourcesMigration).toContain(key)
    }
    expect(m6aSourcesMigration).toMatch(/on conflict \(key\) do update set/)
  })

  it('inserts both new sources disabled (enabled = false), pending Codex review', () => {
    const valuesClause = m6aSourcesMigration.split(/on conflict \(key\) do update set/)[0]!
    const rowLines = valuesClause
      .split('\n')
      .filter((line) => line.trim().startsWith("('jooble-morocco'") || line.trim().startsWith("('smartrecruiters-wavestone'"))
    expect(rowLines).toHaveLength(2)
    for (const line of rowLines) {
      expect(line).toMatch(/,\s*false\)/)
    }
  })

  it('never overwrites `enabled` on conflict, so a reviewed enable/disable survives re-running this migration', () => {
    const updateSetClause = m6aSourcesMigration.split(/on conflict \(key\) do update set/)[1]!
    expect(updateSetClause).not.toMatch(/\benabled\s*=/)
  })

  it('never edits any prior migration file (forward-only) and does not carry a JOOBLE_API_KEY value', () => {
    expect(m6aSourcesMigration).not.toMatch(/JOOBLE_API_KEY\s*=\s*['"]?\w/)
    expect(seedMigration).not.toContain('jooble-morocco')
    expect(seedMigration).not.toContain('smartrecruiters-wavestone')
  })

  it('gives jooble-morocco the fixed employer_identifier "ma.jooble.org" and the exact allowlisted host', () => {
    expect(m6aSourcesMigration).toMatch(/'jooble-morocco',\s*'Jooble Morocco',\s*'jooble',\s*'ma\.jooble\.org'/)
    expect(m6aSourcesMigration).toMatch(/array\['ma\.jooble\.org'\]/)
  })

  it('configures smartrecruiters-wavestone with its documented employer identifier, MA-only', () => {
    expect(m6aSourcesMigration).toMatch(/'smartrecruiters-wavestone',\s*'Wavestone',\s*'smartrecruiters',\s*'Wavestone1'/)
    expect(m6aSourcesMigration).toMatch(/'smartrecruiters-wavestone'[\s\S]*?array\['MA'\]/)
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

describe('search_offers migration (structural)', () => {
  const codeLines = searchOffersMigration.split('\n').filter((line) => !line.trim().startsWith('--'))
  const codeText = codeLines.join('\n')

  it('never builds a PostgREST .or()/in filter or a raw not.in string', () => {
    expect(codeText).not.toMatch(/\.or\(/)
    expect(codeText).not.toMatch(/not\.in/)
  })

  it('grants execute to anon only, after revoking public, for both functions', () => {
    for (const fn of ['escape_ilike_pattern(text)', 'search_offers(text,text,text,text,text,text,boolean,text,text,timestamptz,uuid,integer)']) {
      const revokeIndex = searchOffersMigration.indexOf(`revoke all on function public.${fn} from public;`)
      const grantIndex = searchOffersMigration.indexOf(`grant execute on function public.${fn} to anon;`)
      expect(revokeIndex).toBeGreaterThan(-1)
      expect(grantIndex).toBeGreaterThan(-1)
      expect(grantIndex).toBeGreaterThan(revokeIndex)
    }
  })

  it('is not declared security definer (must run under the caller\'s own RLS)', () => {
    expect(codeText).not.toMatch(/security definer/i)
  })

  it('builds every ilike pattern only via the four documented ilike comparisons (city filter + q against title/company/city), each escaped and routed through escape_ilike_pattern', () => {
    // Matches only actual `column ilike` comparisons — not the
    // `escape_ilike_pattern` function name, which also contains the
    // substring "ilike" and would otherwise inflate this count.
    const ilikeComparisonLines = codeLines.filter((line) => /\bo\.\w+ ilike /i.test(line))
    expect(ilikeComparisonLines).toHaveLength(4)
    for (const line of ilikeComparisonLines) {
      expect(line).toMatch(/escape_ilike_pattern/)
      expect(line).toMatch(/escape '\\'/)
    }
  })

  it('searches specialties and technologies via a safely escaped unnest(), never array_to_string (which could false-match across a concatenation boundary)', () => {
    const tagSearchLines = codeLines.filter((line) => /tag ilike /i.test(line))
    expect(tagSearchLines.length).toBeGreaterThan(0)
    for (const line of tagSearchLines) {
      expect(line).toMatch(/escape_ilike_pattern/)
      expect(line).toMatch(/escape '\\'/)
    }
    expect(codeText).toMatch(/unnest\(o\.specialties \|\| o\.technologies\)/)
    expect(codeText).not.toMatch(/array_to_string/)
  })

  it('sanitizes every direct-RPC-callable input via a `with sanitized as (...)` CTE before using it in the WHERE clause', () => {
    expect(codeText).toMatch(/with sanitized as \(/)
    // Length bounds mirror src/lib/offers/query-schema.ts.
    expect(codeText).toMatch(/left\(p_query, 100\)/)
    expect(codeText).toMatch(/left\(p_city, 80\)/)
    expect(codeText).toMatch(/left\(p_technology, 40\)/)
    // p_limit is clamped to [1, 25] — the server's own max UI limit (24) + 1.
    expect(codeText).toMatch(/least\(greatest\(coalesce\(p_limit, \d+\), 1\), 25\)/)
    // The cursor pair is only honored when both value and id are present.
    expect(codeText).toMatch(/p_cursor_value is not null and p_cursor_id is not null/)
  })

  it('hard-codes status = active as defense in depth', () => {
    expect(codeText).toMatch(/o\.status = 'active'/)
  })
})
