import { z } from 'zod'
import { parseUpstashConfig } from './rate-limit/config'

/**
 * Deployment environment label. `VERCEL_ENV=production` is AUTHORITATIVE
 * and can never be downgraded by `APP_ENV` (M3 review: `APP_ENV=development`
 * with `VERCEL_ENV=production` previously resolved to a fully-valid
 * development environment, silently disabling every production-only
 * requirement on a real production deployment). Outside that one case, an
 * explicit `APP_ENV` still wins over `VERCEL_ENV` (e.g. `APP_ENV=production`
 * intentionally tightening a preview deployment remains allowed — that's
 * upgrading strictness, not downgrading a real production signal); a
 * plain local/CI run defaults to `development`. Intentionally NOT derived
 * from `NODE_ENV`, which Next.js forces to `production` for every `next
 * build` regardless of deployment stage — keying off it would make an
 * ordinary local or CI build require real Supabase credentials.
 */
export type AppEnv = 'development' | 'preview' | 'production'

export interface Env {
  supabaseUrl: string
  supabaseAnonKey: string
  siteUrl: string
  appEnv: AppEnv
  cursorSecret: string
}

export class EnvValidationError extends Error {
  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`)
    this.name = 'EnvValidationError'
  }
}

const APP_ENVS = ['development', 'preview', 'production'] as const
const appEnvSchema = z.enum(APP_ENVS)

const MIN_SUPABASE_ANON_KEY_LENGTH = 20
const MIN_CURSOR_SECRET_LENGTH = 32
// Fixed, publicly-known, non-secret placeholder: safe only because a
// pagination cursor carries no sensitive data (see src/lib/offers/cursor.ts)
// and this value is never used once CURSOR_SECRET is set in production.
const DEV_CURSOR_SIGNING_DEFAULT = 'dev-insecure-cursor-secret-do-not-use-in-production'
const CREDENTIAL_LIKE_NAME = /secret|service[_-]?role|private[_-]?key|passwd|password/i

function createHttpsUrlSchema(allowLocalHttp: boolean) {
  return z
    .string()
    .min(1, 'must not be empty')
    .refine((value) => {
      let url: URL
      try {
        url = new URL(value)
      } catch {
        return false
      }
      if (url.protocol === 'https:') return true
      const isLocalHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
      return allowLocalHttp && url.protocol === 'http:' && isLocalHost
    }, allowLocalHttp ? 'must be an HTTPS URL (HTTP is only allowed for localhost)' : 'must be an HTTPS URL')
}

type EnvSource = Record<string, string | undefined>

function collectPublicCredentialShapedNames(source: EnvSource): string[] {
  return Object.keys(source).filter(
    (key) => key.startsWith('NEXT_PUBLIC_') && CREDENTIAL_LIKE_NAME.test(key),
  )
}

/**
 * Pure, side-effect-free environment parser. Never reads `process.env`
 * itself so it can be exercised with arbitrary input in tests; the `env`
 * singleton below is the only caller that reaches for the real process
 * environment.
 */
export function loadEnv(source: EnvSource): Env {
  const issues: string[] = []

  for (const name of collectPublicCredentialShapedNames(source)) {
    issues.push(`${name} looks credential-shaped and must not carry the NEXT_PUBLIC_ prefix`)
  }

  let appEnv: AppEnv
  if (source.VERCEL_ENV === 'production') {
    // Vercel's own production signal is authoritative and never
    // downgraded by APP_ENV — see the AppEnv doc comment above.
    appEnv = 'production'
  } else {
    const appEnvResult = appEnvSchema.safeParse(source.APP_ENV ?? source.VERCEL_ENV ?? 'development')
    appEnv = appEnvResult.success ? appEnvResult.data : 'development'
    if (!appEnvResult.success) {
      issues.push(`APP_ENV must be one of ${APP_ENVS.join(', ')}`)
    }
  }

  const isProduction = appEnv === 'production'
  const urlSchema = createHttpsUrlSchema(!isProduction)

  let supabaseUrl = ''
  const supabaseUrlRaw = source.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (supabaseUrlRaw.length > 0) {
    const result = urlSchema.safeParse(supabaseUrlRaw)
    if (result.success) {
      supabaseUrl = result.data
    } else {
      issues.push(`NEXT_PUBLIC_SUPABASE_URL ${result.error.issues[0]?.message ?? 'is invalid'}`)
    }
  } else if (isProduction) {
    issues.push('NEXT_PUBLIC_SUPABASE_URL is required in production')
  }

  let supabaseAnonKey = ''
  const supabaseAnonKeyRaw = source.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (supabaseAnonKeyRaw.length > 0) {
    if (supabaseAnonKeyRaw.length >= MIN_SUPABASE_ANON_KEY_LENGTH) {
      supabaseAnonKey = supabaseAnonKeyRaw
    } else {
      issues.push(
        `NEXT_PUBLIC_SUPABASE_ANON_KEY must be at least ${MIN_SUPABASE_ANON_KEY_LENGTH} characters`,
      )
    }
  } else if (isProduction) {
    issues.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is required in production')
  }

  let siteUrl = ''
  const siteUrlRaw = source.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const siteUrlResult = urlSchema.safeParse(siteUrlRaw)
  if (siteUrlResult.success) {
    siteUrl = siteUrlResult.data
  } else {
    issues.push(`NEXT_PUBLIC_SITE_URL ${siteUrlResult.error.issues[0]?.message ?? 'is invalid'}`)
  }

  // Signs opaque pagination cursors (src/lib/offers/cursor.ts) — server-only,
  // never NEXT_PUBLIC_. Required in production so cursors stay verifiable
  // across restarts/instances; a fixed, clearly-labeled non-secret default
  // keeps local dev/CI working without any setup.
  let cursorSecret = ''
  const cursorSecretRaw = source.CURSOR_SECRET ?? ''
  if (cursorSecretRaw.length > 0) {
    if (cursorSecretRaw.length >= MIN_CURSOR_SECRET_LENGTH) {
      cursorSecret = cursorSecretRaw
    } else {
      issues.push(`CURSOR_SECRET must be at least ${MIN_CURSOR_SECRET_LENGTH} characters`)
    }
  } else if (isProduction) {
    issues.push('CURSOR_SECRET is required in production')
  } else {
    cursorSecret = DEV_CURSOR_SIGNING_DEFAULT
  }

  // docs/SECURITY.md: "Apply IP-based rate limiting to GET /api/offers" is
  // mandatory, not optional — M3 review finding 5. `parseUpstashConfig`
  // (src/lib/rate-limit/config.ts) is the ONE shared, strict parser also
  // used by `loadRateLimitConfig` (the runtime accessor `limiter.ts`
  // calls) — a single source of truth prevents boot-time validation and
  // runtime behavior from drifting apart, which is exactly how a bare
  // "https://", a credential-bearing URL, and a whitespace-only token
  // were previously all accepted as valid production configuration.
  const upstashResult = parseUpstashConfig(source.UPSTASH_REDIS_REST_URL, source.UPSTASH_REDIS_REST_TOKEN)
  if (isProduction) {
    if (upstashResult.kind === 'absent') {
      issues.push(
        'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are both required in production (mandatory rate limiting on GET /api/offers)',
      )
    } else if (upstashResult.kind === 'invalid') {
      issues.push(`Upstash configuration is invalid: ${upstashResult.reason}`)
    }
  } else if (upstashResult.kind === 'invalid') {
    // Absent (both omitted) stays fine outside production; anything
    // PARTIALLY or incorrectly configured fails loudly in every
    // environment — an environment variable typo should never silently
    // produce an unprotected endpoint.
    issues.push(`Upstash configuration is invalid: ${upstashResult.reason}`)
  }

  if (issues.length > 0) {
    throw new EnvValidationError(issues)
  }

  return { supabaseUrl, supabaseAnonKey, siteUrl, appEnv, cursorSecret }
}

/**
 * Validated at module load — i.e. at process start, per docs/SECURITY.md.
 * Import this instead of reading `process.env` directly anywhere in the app.
 */
export const env: Env = loadEnv(process.env)
