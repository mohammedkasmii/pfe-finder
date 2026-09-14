import { describe, expect, it } from 'vitest'
import { sanitizeDescriptionToPlainText } from './html'

describe('sanitizeDescriptionToPlainText', () => {
  it('passes plain text through unchanged (aside from trimming)', () => {
    expect(sanitizeDescriptionToPlainText('<p>Stage développeur web.</p>')).toBe('Stage développeur web.')
  })

  it('removes <script> content entirely, not just the tag', () => {
    const result = sanitizeDescriptionToPlainText('<p>Bonjour</p><script>alert(1)</script><p>Stage</p>')
    expect(result).not.toContain('alert')
    expect(result).toContain('Bonjour')
    expect(result).toContain('Stage')
  })

  it('removes <style> content entirely', () => {
    const result = sanitizeDescriptionToPlainText('<style>body{color:red}</style><p>Description</p>')
    expect(result).not.toContain('color')
    expect(result).toContain('Description')
  })

  it('removes forms and their inputs', () => {
    const result = sanitizeDescriptionToPlainText('<form><input value="secret"><label>Nom</label></form><p>Stage</p>')
    expect(result).not.toContain('secret')
    expect(result).toContain('Stage')
  })

  it('produces no text from an event-attribute-only payload', () => {
    const result = sanitizeDescriptionToPlainText('<img src="x" onerror="alert(1)"><p>Stage</p>')
    expect(result).not.toContain('alert')
    expect(result).toContain('Stage')
  })

  it('removes iframe and object content (embed is a void element with no content to leak)', () => {
    const result = sanitizeDescriptionToPlainText(
      '<iframe src="https://evil.example.com">trapped</iframe><object>trapped2</object><embed src="https://evil.example.com"><p>Stage</p>',
    )
    expect(result).not.toContain('trapped')
    expect(result).toContain('Stage')
  })

  it('does not throw on malformed/unclosed markup', () => {
    expect(() => sanitizeDescriptionToPlainText('<p>Unclosed <b>bold <i>italic')).not.toThrow()
    expect(sanitizeDescriptionToPlainText('<p>Unclosed <b>bold <i>italic')).toContain('Unclosed')
  })

  it('strips control characters', () => {
    const result = sanitizeDescriptionToPlainText('<p>Stage\x00\x1Fdéveloppeur</p>')
    expect(result).toBe('Stagedéveloppeur')
  })

  it('collapses excessive blank lines', () => {
    const result = sanitizeDescriptionToPlainText('<p>Un</p>\n\n\n\n<p>Deux</p>')
    expect(result).not.toMatch(/\n{3,}/)
  })

  it('truncates to a bounded length', () => {
    const longHtml = `<p>${'a'.repeat(6000)}</p>`
    const result = sanitizeDescriptionToPlainText(longHtml)
    expect(result.length).toBe(5000)
  })

  it('returns an empty string for empty input', () => {
    expect(sanitizeDescriptionToPlainText('')).toBe('')
  })
})
