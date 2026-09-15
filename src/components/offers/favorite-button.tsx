'use client'

import { useFavorites } from '@/lib/favorites/use-favorites'
import type { Dictionary } from '@/lib/i18n/types'

interface FavoriteButtonProps {
  offerId: string
  dictionary: Dictionary
}

export function FavoriteButton({ offerId, dictionary }: FavoriteButtonProps) {
  const { isFavorite, toggleFavorite } = useFavorites()
  const favorite = isFavorite(offerId)
  const { add, remove } = dictionary.offers.favorites

  return (
    <button
      type="button"
      aria-pressed={favorite}
      aria-label={favorite ? remove : add}
      onClick={() => toggleFavorite(offerId)}
      className={
        favorite
          ? 'rounded-pill bg-accent px-4 py-2 text-sm font-semibold text-paper'
          : 'rounded-pill border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:text-ink'
      }
    >
      {favorite ? `♥ ${remove}` : `♡ ${add}`}
    </button>
  )
}
