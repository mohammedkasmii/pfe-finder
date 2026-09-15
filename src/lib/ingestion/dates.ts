/**
 * Never throws: an external, untrusted date-shaped string that doesn't
 * parse as a valid date becomes `null` (docs/SOURCES.md: "leave it null
 * rather than inventing a date") instead of crashing the collector via
 * `Invalid Date.toISOString()`'s `RangeError`. Shared by every source
 * adapter that has its own "published/updated at" field
 * (`src/lib/sources/smartrecruiters/normalize.ts`,
 * `src/lib/sources/jooble/normalize.ts`).
 */
export function parseDateSafely(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}
