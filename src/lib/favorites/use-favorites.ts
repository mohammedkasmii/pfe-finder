'use client'

import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'pfe-finder:favorites'
const MAX_FAVORITES = 200

const EMPTY: string[] = []
const listeners = new Set<() => void>()

// useSyncExternalStore requires getSnapshot to return a referentially
// stable value when nothing changed (otherwise it re-renders forever) —
// cache the parsed result against the raw string it was parsed from.
let cachedRaw: string | null | undefined
let cachedSnapshot: string[] = EMPTY

function parseRaw(raw: string | null): string[] {
  if (!raw) return EMPTY
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return EMPTY
    return Array.from(new Set(parsed.filter((value): value is string => typeof value === 'string')))
  } catch {
    return EMPTY
  }
}

function getSnapshot(): string[] {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === cachedRaw) return cachedSnapshot
  cachedRaw = raw
  cachedSnapshot = parseRaw(raw)
  return cachedSnapshot
}

// Server-rendered and the very first client render before hydration both
// see an empty list — no hydration mismatch, and no per-device favorite
// state is ever meaningful on the server anyway (docs/PRODUCT.md:
// favorites live only on the current device).
function getServerSnapshot(): string[] {
  return EMPTY
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  function handleStorageEvent(event: StorageEvent) {
    if (event.key === STORAGE_KEY) onStoreChange()
  }
  window.addEventListener('storage', handleStorageEvent)
  return () => {
    listeners.delete(onStoreChange)
    window.removeEventListener('storage', handleStorageEvent)
  }
}

function writeStoredFavorites(ids: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_FAVORITES)))
  } catch {
    // Storage unavailable (private browsing, quota exceeded, disabled) —
    // favorites simply don't persist this session; never crash the page.
  }
  // The native `storage` event fires only in OTHER tabs/windows, never the
  // one that made the write — notify this tab's own subscribers directly
  // so every `useFavorites()` instance on the current page stays in sync.
  for (const listener of listeners) listener()
}

export interface UseFavoritesResult {
  favoriteIds: string[]
  isFavorite(id: string): boolean
  toggleFavorite(id: string): void
}

/**
 * Favorites are local-only, no account (docs/PRODUCT.md: "Favorites are
 * stored in browser local storage... available only on the current
 * device"). Built on `useSyncExternalStore` — the standard React way to
 * read external mutable state like localStorage — rather than
 * `useState`+`useEffect`, so there's no synchronous setState-in-an-effect
 * and no hydration mismatch (server and first client render both see the
 * empty snapshot from `getServerSnapshot`).
 */
export function useFavorites(): UseFavoritesResult {
  const favoriteIds = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const toggleFavorite = useCallback((id: string) => {
    const current = getSnapshot()
    const next = current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id]
    writeStoredFavorites(next)
  }, [])

  const isFavorite = useCallback((id: string) => favoriteIds.includes(id), [favoriteIds])

  return { favoriteIds, isFavorite, toggleFavorite }
}
