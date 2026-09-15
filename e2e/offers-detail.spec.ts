import { expect, test } from '@playwright/test'

/**
 * Exercises the real M3 offer detail page against deterministic fixture
 * data served by the local test server (see offers-search.spec.ts's
 * header comment). M3 review finding 4: malformed, inactive, and
 * genuinely missing offers must all return a REAL HTTP 404 — directly
 * verifiable here because the fixture data layer never throws (unlike
 * the unconfigured-Supabase case in earlier rounds).
 */

const EXISTING_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const INACTIVE_ID = 'aaaaaaaa-0000-4000-8000-00000000000f'
const WELL_FORMED_MISSING_ID = '99999999-9999-4999-8999-999999999999'

test('a malformed id returns a real HTTP 404 with the translated not-found page', async ({ page }) => {
  const response = await page.goto('/offers/not-a-uuid')
  expect(response?.status()).toBe(404)
  await expect(page.getByText('Offre introuvable')).toBeVisible()
})

test('a well-formed but nonexistent id returns a real HTTP 404', async ({ page }) => {
  const response = await page.goto(`/offers/${WELL_FORMED_MISSING_ID}`)
  expect(response?.status()).toBe(404)
  await expect(page.getByText('Offre introuvable')).toBeVisible()
})

test('an inactive offer id returns a real HTTP 404, never its content', async ({ page }) => {
  const response = await page.goto(`/offers/${INACTIVE_ID}`)
  expect(response?.status()).toBe(404)
  await expect(page.getByText('Stage Archivé')).not.toBeVisible()
})

test('an existing active offer renders with a real HTTP 200 and its content', async ({ page }) => {
  const response = await page.goto(`/offers/${EXISTING_ID}`)
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Stage PFE Développeur Full Stack' })).toBeVisible()
  await expect(page.getByText('Atlas Software')).toBeVisible()
})

test('the apply link is a safe external link (https, noopener, noreferrer, new tab)', async ({ page }) => {
  await page.goto(`/offers/${EXISTING_ID}`)
  const applyLink = page.getByRole('link', { name: 'Postuler' })
  await expect(applyLink).toBeVisible()
  await expect(applyLink).toHaveAttribute('href', /^https:\/\//)
  await expect(applyLink).toHaveAttribute('target', '_blank')
  await expect(applyLink).toHaveAttribute('rel', 'noopener noreferrer')
})

test('the favorite button on the detail page persists across a reload', async ({ page }) => {
  await page.goto(`/offers/${EXISTING_ID}`)
  await page.getByRole('button', { name: 'Ajouter aux favoris' }).click()
  await expect(page.getByRole('button', { name: 'Retirer des favoris' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Retirer des favoris' })).toBeVisible()
})

test('the offer detail page keeps the header, footer, and language switch intact', async ({ page }) => {
  await page.goto(`/offers/${EXISTING_ID}`)
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toBeVisible()
  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('header navigation on the detail page: Home goes to the homepage', async ({ page }) => {
  await page.goto(`/offers/${EXISTING_ID}`)
  await page.getByRole('link', { name: 'Accueil' }).click()
  await page.waitForURL((url) => url.pathname === '/')
})

test('"back to search" returns to the offers list', async ({ page }) => {
  await page.goto(`/offers/${EXISTING_ID}`)
  await page.getByRole('link', { name: /retour à la recherche/i }).click()
  await page.waitForURL((url) => url.pathname === '/offers')
})
