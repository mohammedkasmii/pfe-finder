import { z } from 'zod'

/**
 * Fields every source shares regardless of adapter. `employerIdentifier`
 * is deliberately NOT here — it only makes sense for the SmartRecruiters
 * adapter contract, and a Jooble source config must never carry an API
 * key or any other secret (docs/SECURITY.md M6A: the Jooble key is
 * loaded lazily, collector-only, from `process.env` — never part of this
 * developer-controlled registry).
 */
interface BaseSourceConfig {
  key: string
  name: string
  attributionUrl: string
  allowedHosts: readonly string[]
  countries: readonly ('MA' | 'FR')[]
}

export interface SmartRecruitersSourceConfig extends BaseSourceConfig {
  adapter: 'smartrecruiters'
  employerIdentifier: string
}

export interface JoobleSourceConfig extends BaseSourceConfig {
  adapter: 'jooble'
}

/**
 * Strict discriminated union on `adapter` — narrows to the right shape
 * (e.g. `source.employerIdentifier` only exists on the SmartRecruiters
 * variant) instead of every adapter having to defensively check for
 * fields that only apply to some sources.
 */
export type SourceConfig = SmartRecruitersSourceConfig | JoobleSourceConfig

const BASE_FIELDS = {
  key: z.string().min(1),
  name: z.string().min(1),
  attributionUrl: z.url({ protocol: /^https$/ }),
  allowedHosts: z.array(z.string().min(1)).min(1),
  countries: z.array(z.enum(['MA', 'FR'])).min(1),
}

const SmartRecruitersSourceConfigSchema = z.object({
  ...BASE_FIELDS,
  adapter: z.literal('smartrecruiters'),
  employerIdentifier: z.string().min(1),
})

const JoobleSourceConfigSchema = z.object({
  ...BASE_FIELDS,
  adapter: z.literal('jooble'),
})

/**
 * Runtime companion to the `SourceConfig` TypeScript type. The registry
 * below is a hardcoded, developer-controlled constant today, but this
 * schema is still asserted against it at module load (self-check) so a
 * malformed entry is caught immediately at import time rather than deep
 * inside a collector run — and it's ready for a future where source
 * configuration might come from somewhere less trusted than a literal in
 * this file.
 */
export const SourceConfigSchema = z.discriminatedUnion('adapter', [
  SmartRecruitersSourceConfigSchema,
  JoobleSourceConfigSchema,
])

// Mirrors docs/SOURCES.md exactly. `APPROVED_FOR_BUILD` sources (the three
// original SmartRecruiters feeds) plus the two M6A `PENDING_CODEX_REVIEW`
// additions — inserted disabled in the seed/expansion migrations until
// Codex records a reviewed approval (docs/SOURCES.md).
export const SOURCE_REGISTRY: readonly SourceConfig[] = [
  {
    key: 'smartrecruiters-inetum',
    name: 'Inetum',
    adapter: 'smartrecruiters',
    employerIdentifier: 'Inetum2',
    attributionUrl: 'https://jobs.smartrecruiters.com/Inetum2',
    allowedHosts: ['api.smartrecruiters.com', 'jobs.smartrecruiters.com'],
    countries: ['MA', 'FR'],
  },
  {
    key: 'smartrecruiters-devoteam',
    name: 'Devoteam',
    adapter: 'smartrecruiters',
    employerIdentifier: 'Devoteam',
    attributionUrl: 'https://jobs.smartrecruiters.com/Devoteam',
    allowedHosts: ['api.smartrecruiters.com', 'jobs.smartrecruiters.com'],
    countries: ['FR'],
  },
  {
    key: 'smartrecruiters-mazars',
    name: 'Forvis Mazars',
    adapter: 'smartrecruiters',
    employerIdentifier: 'MAZARS',
    attributionUrl: 'https://jobs.smartrecruiters.com/MAZARS',
    allowedHosts: ['api.smartrecruiters.com', 'jobs.smartrecruiters.com'],
    countries: ['MA', 'FR'],
  },
  {
    key: 'smartrecruiters-wavestone',
    name: 'Wavestone',
    adapter: 'smartrecruiters',
    employerIdentifier: 'Wavestone1',
    attributionUrl: 'https://jobs.smartrecruiters.com/Wavestone1',
    allowedHosts: ['api.smartrecruiters.com', 'jobs.smartrecruiters.com'],
    countries: ['MA'],
  },
  {
    key: 'jooble-morocco',
    name: 'Jooble Morocco',
    adapter: 'jooble',
    attributionUrl: 'https://ma.jooble.org/',
    allowedHosts: ['ma.jooble.org'],
    countries: ['MA'],
  },
]

for (const source of SOURCE_REGISTRY) {
  SourceConfigSchema.parse(source)
}
