'use client'

/**
 * Last-resort error boundary for /offers and /offers/[id]. In practice
 * both page components already catch their own data-fetching failures
 * and render a translated in-page error state (see page.tsx), so this
 * only fires for a genuinely unexpected error. error.tsx boundaries must
 * be Client Components in Next.js, which can't call the server-only
 * `getLocale()`/`getDictionary()` — so this stays a minimal, deliberately
 * bilingual fallback rather than pulling in the full i18n system.
 */
export default function OffersError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-6 py-16 text-center sm:px-10">
      <p role="alert" className="text-sm text-accent-dark">
        Offers could not be loaded right now. Try again later. — Impossible de charger les offres pour le moment.
        Réessayez plus tard.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-pill bg-primary px-5 py-2.5 text-sm font-semibold text-paper hover:bg-primary-dark"
      >
        Try again / Réessayer
      </button>
    </main>
  )
}
