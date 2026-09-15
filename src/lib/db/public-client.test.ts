import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// The real `env` singleton reads process.env, which carries no Supabase
// credentials in this test environment — stub it so getPublicSupabaseClient
// can be exercised (including its caching behavior) without needing a real
// Supabase project configured.
vi.mock('../env', () => ({
  env: { supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'a'.repeat(40) },
}))

describe('getPublicSupabaseClient', () => {
  it('returns the same cached instance on repeated calls', async () => {
    const { getPublicSupabaseClient } = await import('./public-client')
    const first = getPublicSupabaseClient()
    const second = getPublicSupabaseClient()
    expect(first).toBe(second)
  })

  it('never imports the service-role client module, fixture/fake-data infrastructure, or reads SUPABASE_SERVICE_ROLE_KEY', () => {
    const source = readFileSync(join(__dirname, 'public-client.ts'), 'utf8')
    // Strip comment lines first: the file's own doc comment explains what
    // NOT to import by naming these strings, which would otherwise be a
    // false positive here.
    const codeOnly = source
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim()
        return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')
      })
      .join('\n')
    expect(codeOnly).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
    expect(codeOnly).not.toMatch(/supabase-client/)
    expect(codeOnly).not.toMatch(/test-data/)
    expect(codeOnly).not.toMatch(/PFE_E2E_TEST_DATA/)
    expect(codeOnly).not.toMatch(/createTestSupabaseClient/)
  })

  it('only ever imports @supabase/supabase-js and the local env module', () => {
    const source = readFileSync(join(__dirname, 'public-client.ts'), 'utf8')
    const importLines = source.split('\n').filter((line) => line.trim().startsWith('import '))
    for (const line of importLines) {
      expect(line).toMatch(/@supabase\/supabase-js|\.\.\/env/)
    }
  })
})
