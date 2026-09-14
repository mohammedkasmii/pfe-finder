import { describe, expect, it } from 'vitest'
import { classifySpecialties, SPECIALTIES_DICTIONARY_VERSION, SPECIALTY_SLUGS } from './specialties'

describe('SPECIALTIES_DICTIONARY_VERSION', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(SPECIALTIES_DICTIONARY_VERSION)).toBe(true)
    expect(SPECIALTIES_DICTIONARY_VERSION).toBeGreaterThan(0)
  })
})

describe('classifySpecialties', () => {
  it('matches software-web-mobile from French and English phrasing', () => {
    expect(classifySpecialties('Stage développeur full stack, développement web')).toContain('software-web-mobile')
    expect(classifySpecialties('Software engineer internship building mobile apps')).toContain('software-web-mobile')
  })

  it('matches data-ai', () => {
    expect(classifySpecialties('Stage data scientist, machine learning et intelligence artificielle')).toContain('data-ai')
    expect(classifySpecialties('Data analyst internship working with big data')).toContain('data-ai')
  })

  it('matches cybersecurity', () => {
    expect(classifySpecialties('Stage en cybersécurité et pentest')).toContain('cybersecurity')
    expect(classifySpecialties('Security engineer internship, SOC analyst')).toContain('cybersecurity')
  })

  it('matches cloud-devops', () => {
    expect(classifySpecialties('Stage DevOps, Docker, Kubernetes, CI/CD')).toContain('cloud-devops')
    expect(classifySpecialties('Cloud engineer internship using AWS and Terraform')).toContain('cloud-devops')
  })

  it('matches systems-networks', () => {
    expect(classifySpecialties('Stage administrateur système et réseaux')).toContain('systems-networks')
    expect(classifySpecialties('Network engineer internship, sysadmin tasks')).toContain('systems-networks')
  })

  it('matches qa-testing', () => {
    expect(classifySpecialties('Stage QA, test automation logiciel')).toContain('qa-testing')
    expect(classifySpecialties('Quality assurance internship, test automation')).toContain('qa-testing')
  })

  it('returns an empty array for unrelated text', () => {
    expect(classifySpecialties('Stage assistant comptable, gestion administrative')).toEqual([])
  })

  it('returns every documented slug exactly once even if mentioned multiple times', () => {
    const result = classifySpecialties('développeur développeur développeur')
    expect(result.filter((s) => s === 'software-web-mobile')).toHaveLength(1)
  })

  it('SPECIALTY_SLUGS has exactly the six documented specialties from docs/PRODUCT.md', () => {
    expect(SPECIALTY_SLUGS).toEqual([
      'software-web-mobile',
      'data-ai',
      'cybersecurity',
      'cloud-devops',
      'systems-networks',
      'qa-testing',
    ])
  })
})
