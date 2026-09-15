import { describe, expect, it } from 'vitest'
import { classifyPosting } from './classification'
import { POSTING_FIXTURES } from './fixtures/postings'
import { sanitizeDescriptionToPlainText } from './html'

describe('classifyPosting — documented fixtures', () => {
  for (const fixture of POSTING_FIXTURES) {
    it(fixture.description, () => {
      const descriptionText = sanitizeDescriptionToPlainText(fixture.descriptionHtml)
      const result = classifyPosting({
        title: fixture.title,
        descriptionText,
        experienceLevelId: fixture.experienceLevelId,
      })

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

describe('classifyPosting — experienceLevelId gate (post-deployment correction)', () => {
  const csDescription = 'Stage de développement web avec React et Node.js.'

  it('accepts when experienceLevelId is "internship"', () => {
    const result = classifyPosting({
      title: 'Stage Développeur',
      descriptionText: csDescription,
      experienceLevelId: 'internship',
    })
    expect(result).not.toBeNull()
  })

  it('accepts when experienceLevelId is absent (no signal either way)', () => {
    const result = classifyPosting({ title: 'Stage Développeur', descriptionText: csDescription })
    expect(result).not.toBeNull()
  })

  it('rejects any explicit non-internship experienceLevelId, even with a strong CS signal', () => {
    for (const experienceLevelId of ['associate', 'mid_senior_level', 'director', 'executive']) {
      const result = classifyPosting({ title: 'Stage Développeur', descriptionText: csDescription, experienceLevelId })
      expect(result).toBeNull()
    }
  })

  it('is case-insensitive', () => {
    const result = classifyPosting({
      title: 'Stage Développeur',
      descriptionText: csDescription,
      experienceLevelId: 'ASSOCIATE',
    })
    expect(result).toBeNull()
  })
})

describe('classifyPosting — title-only hard domain exclusion (Codex review correction)', () => {
  it('rejects a customer-engagement internship title even with an incidental GCP mention', () => {
    const result = classifyPosting({
      title: 'Stage Chargé(e) de l’Engagement & activation Client',
      descriptionText: 'Stage marketing client, activation client, nous utilisons GCP pour le reporting.',
      experienceLevelId: 'internship',
    })
    expect(result).toBeNull()
  })

  it('rejects a sustainability/ESG audit internship title even with generic "data"/"outils informatiques" mentions', () => {
    const result = classifyPosting({
      title: 'Stage de Fin d’études - Sustainability Audit',
      descriptionText: 'Stage RSE, audit de durabilité ESG, exploitation de data via nos outils informatiques.',
      experienceLevelId: 'internship',
    })
    expect(result).toBeNull()
  })

  it('still accepts a genuine cloud/DevOps internship that legitimately mentions GCP', () => {
    const result = classifyPosting({
      title: 'Stage Ingénieur Cloud',
      descriptionText: 'Stage DevOps, infrastructure sur GCP et Kubernetes.',
      experienceLevelId: 'internship',
    })
    expect(result).not.toBeNull()
  })

  it('does NOT reject a genuine CS internship merely because its DESCRIPTION mentions sustainability/ESG/RSE/customer engagement/a business school (only the title is checked)', () => {
    const result = classifyPosting({
      title: 'Stage Développeur Full Stack',
      descriptionText:
        'Stage de développement web avec React et Node.js pour notre plateforme de reporting RSE/ESG destinée aux équipes engagement client, ouvert aux profils école de commerce ou informatique.',
      experienceLevelId: 'internship',
    })
    expect(result).not.toBeNull()
  })

  it('does NOT reject a bare sustainability/ESG title word without an audit/consulting role word', () => {
    const result = classifyPosting({
      title: 'Stage développeur TypeScript — plateforme RSE/ESG',
      descriptionText: 'Stage de développement logiciel en TypeScript pour une plateforme de reporting RSE/ESG.',
      experienceLevelId: 'internship',
    })
    expect(result).not.toBeNull()
  })

  it('does NOT reject a title mentioning "customer engagement" as a product/platform, not the role itself', () => {
    const result = classifyPosting({
      title: 'Software engineering internship — customer engagement platform',
      descriptionText: 'Backend internship building our customer engagement platform in TypeScript and PostgreSQL.',
      experienceLevelId: 'internship',
    })
    expect(result).not.toBeNull()
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
