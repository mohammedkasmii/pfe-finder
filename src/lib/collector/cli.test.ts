import { describe, expect, it } from 'vitest'
import { SOURCE_REGISTRY } from '../sources/registry'
import { createAdapterForSource } from './cli'

describe('createAdapterForSource (adapter factory selection, M6A)', () => {
  it('creates a working adapter for every configured source, matching its own source.adapter', () => {
    for (const source of SOURCE_REGISTRY) {
      const adapter = createAdapterForSource(source)
      expect(adapter.sourceKey).toBe(source.key)
      expect(adapter.source).toBe(source)
      expect(typeof adapter.collect).toBe('function')
    }
  })

  it('creates a Jooble-shaped adapter for the jooble-morocco source without requiring JOOBLE_API_KEY at construction time', () => {
    const jooble = SOURCE_REGISTRY.find((s) => s.key === 'jooble-morocco')!
    expect(() => createAdapterForSource(jooble)).not.toThrow()
  })

  it('creates a SmartRecruiters adapter for every smartrecruiters-adapter source', () => {
    for (const source of SOURCE_REGISTRY.filter((s) => s.adapter === 'smartrecruiters')) {
      expect(() => createAdapterForSource(source)).not.toThrow()
    }
  })
})
