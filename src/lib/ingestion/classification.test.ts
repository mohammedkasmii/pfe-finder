import { describe, expect, it } from 'vitest'
import { classifyPosting } from './classification'
import { POSTING_FIXTURES } from './fixtures/postings'
import { sanitizeDescriptionToPlainText } from './html'

describe('classifyPosting — documented fixtures', () => {
  for (const fixture of POSTING_FIXTURES) {
    it(fixture.description, () => {
      const descriptionText = sanitizeDescriptionToPlainText(fixture.descriptionHtml)
      const result = classifyPosting({ title: fixture.title, descriptionText })

      if (!fixture.expectAccepted) {
        expect(result).toBeNull()
        return
      }

      expect(result).not.toBeNull()
      if (fixture.expectIsPfe !== undefined) {
        expect(result?.isPfe).toBe(fixture.expectIsPfe)
      }
    })
  }
})

describe('classifyPosting — work mode', () => {
  it('detects remote', () => {
    const result = classifyPosting({ title: 'Stage Développeur', descriptionText: 'Stage en télétravail complet.' })
    expect(result?.workMode).toBe('remote')
  })

  it('detects hybrid', () => {
    const result = classifyPosting({ title: 'Stage Développeur', descriptionText: 'Stage en mode hybride.' })
    expect(result?.workMode).toBe('hybrid')
  })

  it('detects onsite', () => {
    const result = classifyPosting({ title: 'Stage Développeur', descriptionText: 'Stage sur site, présentiel.' })
    expect(result?.workMode).toBe('onsite')
  })

  it('defaults to unknown when no work-mode signal is present', () => {
    const result = classifyPosting({ title: 'Stage Développeur', descriptionText: 'Stage en développement web.' })
    expect(result?.workMode).toBe('unknown')
  })
})

describe('classifyPosting — rejects non-internship contract types even with CS signal', () => {
  it('rejects a CDD with clear CS content', () => {
    expect(
      classifyPosting({ title: 'Développeur Web (CDD)', descriptionText: 'Poste en CDD, développement React.' }),
    ).toBeNull()
  })
})

describe('classifyPosting — PFE phrase must match an apostrophe, not any character', () => {
  it('does not treat "dXétudes" as the PFE phrase (regression: `.` wildcard in the pattern)', () => {
    const result = classifyPosting({
      title: 'Stage Développeur',
      descriptionText: 'Stage de fin dXétudes en développement web avec React.',
    })
    expect(result).not.toBeNull()
    expect(result?.isPfe).toBe(false)
  })

  it('still matches the real phrase with a straight apostrophe', () => {
    const result = classifyPosting({
      title: 'Stage Développeur',
      descriptionText: "Stage de fin d'études en développement web avec React.",
    })
    expect(result?.isPfe).toBe(true)
  })

  it('still matches the real phrase with a curly apostrophe', () => {
    const result = classifyPosting({
      title: 'Stage Développeur',
      descriptionText: 'Stage de fin d’études en développement web avec React.',
    })
    expect(result?.isPfe).toBe(true)
  })
})
