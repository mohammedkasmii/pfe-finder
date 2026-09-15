const FRENCH_MARKERS = /\b(le|la|les|des|un|une|et|pour|avec|vous|nous|stage|d[ée]veloppeur)\b/gi
const ENGLISH_MARKERS = /\b(the|and|for|with|you|we|internship|developer)\b/gi

/**
 * Lightweight heuristic, not a real language detector: counts French vs.
 * English stopword hits and picks the higher count, defaulting to French
 * on a tie or empty text. Documented limitation — good enough for two
 * languages with this much stopword divergence, not a general solution.
 * Shared by every source adapter (`src/lib/sources/smartrecruiters/normalize.ts`,
 * `src/lib/sources/jooble/normalize.ts`).
 */
export function detectLanguage(text: string): 'fr' | 'en' {
  const frenchHits = (text.match(FRENCH_MARKERS) ?? []).length
  const englishHits = (text.match(ENGLISH_MARKERS) ?? []).length
  return englishHits > frenchHits ? 'en' : 'fr'
}
