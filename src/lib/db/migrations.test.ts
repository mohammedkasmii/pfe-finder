import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = join(__dirname, '../../../supabase/migrations')

function readMigrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }))
}

describe('supabase migrations', () => {
  const migrations = readMigrations()
  const allSql = migrations.map((m) => m.sql).join('\n')

  it('creates the three documented tables', () => {
    expect(allSql).toMatch(/create table public\.sources/)
    expect(allSql).toMatch(/create table public\.offers/)
    expect(allSql).toMatch(/create table public\.ingestion_runs/)
  })

  it('enforces the documented unique/check constraints', () => {
    expect(allSql).toMatch(/unique \(source_key, external_id\)/)
    expect(allSql).toMatch(/country in \('MA','FR'\)/)
    expect(allSql).toMatch(/status in \('active','inactive'\)/)
  })

  it('names migration files in lexically increasing order (Supabase CLI convention)', () => {
    const names = migrations.map((m) => m.name)
    expect(names).toEqual([...names].sort())
    expect(names.length).toBeGreaterThanOrEqual(5)
  })

  it('references sources as a foreign key from offers and ingestion_runs', () => {
    expect(allSql).toMatch(/source_key text not null references public\.sources\(key\)/g)
  })
})
