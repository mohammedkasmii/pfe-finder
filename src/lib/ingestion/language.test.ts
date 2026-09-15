import { describe, expect, it } from 'vitest'
import { detectLanguage } from './language'

describe('detectLanguage', () => {
  it('detects French text', () => {
    expect(detectLanguage('Stage de développement web avec React et Node.js pour vous.')).toBe('fr')
  })

  it('detects English text', () => {
    expect(detectLanguage('We are looking for an internship developer for the backend team.')).toBe('en')
  })

  it('defaults to French on an empty string', () => {
    expect(detectLanguage('')).toBe('fr')
  })

  it('defaults to French on a tie', () => {
    expect(detectLanguage('le the')).toBe('fr')
  })
})
