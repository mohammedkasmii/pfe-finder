import { defineConfig, devices } from '@playwright/test'

const TEST_SERVER_PORT = 54321

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Keep readable local output and emit GitHub Check annotations in CI.
  // Public Actions logs require repository authentication, while check
  // annotations remain visible to reviewers and identify the exact failed
  // spec without exposing environment values or browser traces.
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  // Two independent servers: a minimal local PostgREST-shaped HTTP
  // server serving deterministic, clearly-fictional fixture data
  // (e2e/test-server/ — never imported by anything under src/), and the
  // real Next.js app pointed at it via NEXT_PUBLIC_SUPABASE_URL. The app
  // itself carries no test-mode branch, flag, or import — it simply
  // talks to "a Supabase project" that happens to be this local server
  // (M3 review: the previous approach imported a fake client directly
  // into the production runtime, which then shipped inside `.next/server`).
  webServer: [
    {
      command: `node e2e/test-server/server.mjs`,
      port: TEST_SERVER_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { PORT: String(TEST_SERVER_PORT) },
    },
    {
      command: 'pnpm build && pnpm start',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${TEST_SERVER_PORT}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-test-anon-key-not-a-real-credential-000000',
      },
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
})
