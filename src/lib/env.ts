import { z } from 'zod'

/**
 * Deployment environment label. Explicit `APP_ENV` wins; otherwise Vercel's
 * own `VERCEL_ENV` is trusted; a plain local/CI run defaults to
 * `development`. Intentionally NOT derived from `NODE_ENV`, which Next.js
 * forces to `production` for every `next build` regardless of deployment
 * stage — keying off it would make an ordinary local or CI build require
 * real Supabase credentials.
 */
export type AppEnv = 'development' | 'preview' | 'production'

export interface Env {
  supabaseUrl: string
  supabaseAnonKey: string
  siteUrl: string
  appEnv: AppEnv
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

  const appEnvResult = appEnvSchema.safeParse(source.APP_ENV ?? source.VERCEL_ENV ?? 'development')
  const appEnv: AppEnv = appEnvResult.success ? appEnvResult.data : 'development'
  if (!appEnvResult.success) {
    issues.push(`APP_ENV must be one of ${APP_ENVS.join(', ')}`)
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

  if (issues.length > 0) {
    throw new EnvValidationError(issues)
  }

  return { supabaseUrl, supabaseAnonKey, siteUrl, appEnv }
}

/**
 * Validated at module load — i.e. at process start, per docs/SECURITY.md.
 * Import this instead of reading `process.env` directly anywhere in the app.
 */
export const env: Env = loadEnv(process.env)
