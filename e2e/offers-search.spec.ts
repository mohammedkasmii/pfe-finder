import { expect, test } from '@playwright/test'

/**
 * Exercises the real M3 search experience against deterministic,
 * clearly-fictional fixture data served by a Playwright-only local
 * PostgREST-shaped HTTP server (`e2e/test-server/`, started as a second
 * `webServer` entry in playwright.config.ts). The app under test is
 * pointed at that local server via `NEXT_PUBLIC_SUPABASE_URL` — it
 * carries no test-mode flag, branch, or fixture import of its own (M3
 * review: an earlier approach imported a fake client and fictional
 * offers directly into `src/`, which then shipped inside the production
 * build).
 */

test('renders real offer cards with title, company, badges, and source attribution', async ({ page }) => {
  await page.goto('/offers')

  const firstCard = page.getByRole('heading', { name: 'Stage PFE Développeur Full Stack' })
  await expect(firstCard).toBeVisible()
  // "Atlas Software" appears on more than one fixture card by design —
  // scope to the first match.
  await expect(page.getByText('Atlas Software').first()).toBeVisible()
  // PFE badge only on the PFE-flagged fixture card, not every card.
  await expect(page.getByText('PFE').first()).toBeVisible()
  await expect(page.getByText(/Source\s*:\s*Inetum/).first()).toBeVisible()
})

test('combined filters narrow results (country + specialty together)', async ({ page }) => {
  await page.goto('/offers')

  await page.getByLabel('Pays').selectOption('FR')
  await page.getByLabel('Spécialité').selectOption('cybersecurity')
  await page.waitForURL(/country=FR/)
  await page.waitForURL(/specialty=cybersecurity/)

  await expect(page.getByRole('heading', { name: 'Stage Cybersécurité' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Stage PFE Développeur Full Stack' })).not.toBeVisible()
})

test('filters are reflected in the URL and survive a full page reload', async ({ page }) => {
  await page.goto('/offers')
  await page.getByLabel('Pays').selectOption('MA')
  await page.waitForURL(/country=MA/)

  await page.reload()

  await expect(page.getByLabel('Pays')).toHaveValue('MA')
  await expect(page.getByRole('heading', { name: 'Stage Cybersécurité' })).not.toBeVisible()
})

test('an invalid filter value typed into the URL is safely ignored, not crashed on', async ({ page }) => {
  const response = await page.goto('/offers?specialty=not-a-real-slug&country=MA')
  expect(response?.status()).toBeLessThan(500)
  await expect(page.getByText('Certains filtres')).toBeVisible()
  // The still-valid country filter must still apply.
  await expect(page.getByLabel('Pays')).toHaveValue('MA')
})

test('pagination: "load more" reveals additional cards and eventually disappears', async ({ page }) => {
  await page.goto('/offers')

  const loadMoreButton = page.getByRole('button', { name: 'Voir plus d’offres' })
  await expect(loadMoreButton).toBeVisible()

  const initialCount = await page.getByRole('listitem').count()
  await loadMoreButton.click()

  await expect
    .poll(async () => page.getByRole('listitem').count())
    .toBeGreaterThan(initialCount)
})

test('the live region announces the result count after a filter change', async ({ page }) => {
  await page.goto('/offers')
  const liveRegion = page.getByTestId('offers-live-region')

  await page.getByLabel('Pays').selectOption('FR')
  await expect(liveRegion).toContainText(/offre/i)
})

test('favorites persist across a reload and can be removed', async ({ page }) => {
  await page.goto('/offers')

  const favoriteButton = page.getByRole('button', { name: 'Ajouter aux favoris' }).first()
  await favoriteButton.click()
  await expect(page.getByRole('button', { name: 'Retirer des favoris' }).first()).toBeVisible()

  await page.reload()
  const persistedButton = page.getByRole('button', { name: 'Retirer des favoris' }).first()
  await expect(persistedButton).toBeVisible()

  await persistedButton.click()
  await expect(page.getByRole('button', { name: 'Ajouter aux favoris' }).first()).toBeVisible()
})

test('the device-only favorites notice is visible', async ({ page }) => {
  await page.goto('/offers')
  await expect(page.getByText('Les favoris sont enregistrés uniquement sur cet appareil.')).toBeVisible()
})

test('the stale-source banner renders (the fixture data includes a source that has never succeeded)', async ({ page }) => {
  await page.goto('/offers')
  await expect(page.getByText('Données peut-être obsolètes')).toBeVisible()
})

test('switching to English updates the search page content', async ({ page }) => {
  await page.goto('/offers')
  await page.getByRole('button', { name: 'English' }).click()

  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { name: 'Search internships' })).toBeVisible()
  await expect(page.getByLabel('Country')).toBeVisible()
})

test('there is no horizontal overflow at a 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/offers')

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(hasHorizontalOverflow).toBe(false)
})

test('the offers page is keyboard-navigable via the skip link', async ({ page }) => {
  await page.goto('/offers')

  await page.keyboard.press('Tab')
  const skipLink = page.getByRole('link', { name: /aller au contenu principal/i })
  await expect(skipLink).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeVisible()
})

test('header navigation: Home goes to the homepage, not the current page\'s main content', async ({ page }) => {
  await page.goto('/offers')
  await page.getByRole('link', { name: 'Accueil' }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Maroc')
})

test('header navigation: "how it works" and "specialties" target the homepage sections from /offers', async ({ page }) => {
  await page.goto('/offers')

  await page.getByRole('link', { name: 'Comment ça marche' }).click()
  await page.waitForURL((url) => url.pathname === '/' && url.hash === '#how-it-works')
  await expect(page.locator('#how-it-works')).toBeVisible()

  await page.goto('/offers')
  await page.getByRole('link', { name: 'Spécialités' }).click()
  await page.waitForURL((url) => url.pathname === '/' && url.hash === '#specialties')
  await expect(page.locator('#specialties')).toBeVisible()
})
