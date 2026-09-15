import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useFavorites } from './use-favorites'

describe('useFavorites', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('starts empty', () => {
    const { result } = renderHook(() => useFavorites())
    expect(result.current.favoriteIds).toEqual([])
    expect(result.current.isFavorite('11111111-1111-4111-8111-111111111111')).toBe(false)
  })

  it('toggleFavorite adds then removes an id', () => {
    const { result } = renderHook(() => useFavorites())
    const id = '11111111-1111-4111-8111-111111111111'

    act(() => result.current.toggleFavorite(id))
    expect(result.current.isFavorite(id)).toBe(true)
    expect(result.current.favoriteIds).toEqual([id])

    act(() => result.current.toggleFavorite(id))
    expect(result.current.isFavorite(id)).toBe(false)
    expect(result.current.favoriteIds).toEqual([])
  })

  it('persists across a hook re-mount via localStorage', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const first = renderHook(() => useFavorites())
    act(() => first.result.current.toggleFavorite(id))
    first.unmount()

    const second = renderHook(() => useFavorites())
    expect(second.result.current.isFavorite(id)).toBe(true)
  })

  it('deduplicates a pre-seeded localStorage value with a repeated id', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    window.localStorage.setItem('pfe-finder:favorites', JSON.stringify([id, id]))
    const { result } = renderHook(() => useFavorites())
    expect(result.current.favoriteIds).toEqual([id])
  })

  it('ignores a corrupted localStorage value instead of throwing', () => {
    window.localStorage.setItem('pfe-finder:favorites', 'not json')
    expect(() => renderHook(() => useFavorites())).not.toThrow()
  })
})
