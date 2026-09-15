import { createSupabaseIngestionClient, loadSupabaseIngestionCredentials } from '../db/supabase-client'
import { createSupabaseIngestionRepository } from '../db/supabase-repository'
import { boundedErrorSummary } from '../ingestion/error-summary'
import type { SourceAdapter } from '../sources/adapter'
import { createJoobleAdapter } from '../sources/jooble/adapter'
import { SOURCE_REGISTRY } from '../sources/registry'
import { createSmartRecruitersAdapter } from '../sources/smartrecruiters/adapter'
import { runCollector } from './run'

/**
 * Dispatches each configured source to its own adapter factory based on
 * `source.adapter` (docs/ARCHITECTURE.md M6A). `JOOBLE_API_KEY` is loaded
 * lazily inside `createJoobleAdapter(...).collect()` — never here, and
 * never read by this file directly — so a missing/invalid key only fails
 * the Jooble source; every SmartRecruiters adapter still runs.
 */
export function createAdapterForSource(source: (typeof SOURCE_REGISTRY)[number]): SourceAdapter {
  if (source.adapter === 'smartrecruiters') return createSmartRecruitersAdapter({ source })
  return createJoobleAdapter({ source })
}

async function main() {
  const credentials = loadSupabaseIngestionCredentials()
  const client = createSupabaseIngestionClient(credentials)
  const repository = createSupabaseIngestionRepository(client)
  const adapters = SOURCE_REGISTRY.map(createAdapterForSource)

  const summaries = await runCollector({ repository, adapters })

  for (const summary of summaries) {
    // Bounded, structured, no descriptions/credentials — safe for CI logs.
    console.log(JSON.stringify(summary))
  }

  const anyFailed = summaries.some((s) => s.status === 'failed')
  process.exitCode = anyFailed ? 1 : 0
}

main().catch((error) => {
  // Sanitized the same way every ingestion_runs.error_summary is: a crash
  // that escapes runCollector entirely (e.g. a credential-loading or
  // connection failure) must never print a raw connection string, token,
  // or multiline stack to CI logs.
  console.error('collector crashed:', boundedErrorSummary(error instanceof Error ? error.message : 'unknown error'))
  process.exitCode = 1
})
