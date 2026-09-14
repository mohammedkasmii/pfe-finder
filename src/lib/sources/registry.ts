import { z } from 'zod'

export interface SourceConfig {
  key: string
  name: string
  adapter: 'smartrecruiters'
  employerIdentifier: string
  attributionUrl: string
  allowedHosts: readonly string[]
  countries: readonly ('MA' | 'FR')[]
}

/**
 * Runtime companion to the `SourceConfig` TypeScript type. The registry
 * below is a hardcoded, developer-controlled constant today, but this
 * schema is still asserted against it at module load (self-check) so a
 * malformed entry is caught immediately at import time rather than deep
 * inside a collector run — and it's ready for a future where source
 * configuration might come from somewhere less trusted than a literal in
 * this file.
 */
export const SourceConfigSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  adapter: z.literal('smartrecruiters'),
  employerIdentifier: z.string().min(1),
  attributionUrl: z.url({ protocol: /^https$/ }),
  allowedHosts: z.array(z.string().min(1)).min(1),
  countries: z.array(z.enum(['MA', 'FR'])).min(1),
})

// Mirrors docs/SOURCES.md exactly. Only APPROVED_FOR_BUILD sources.
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
]

for (const source of SOURCE_REGISTRY) {
  SourceConfigSchema.parse(source)
}
