import { describe, expect, it } from 'vitest'
import { classifyTechnologies, TECHNOLOGIES_DICTIONARY_VERSION } from './technologies'

describe('TECHNOLOGIES_DICTIONARY_VERSION', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(TECHNOLOGIES_DICTIONARY_VERSION)).toBe(true)
    expect(TECHNOLOGIES_DICTIONARY_VERSION).toBeGreaterThan(0)
  })
})

describe('classifyTechnologies', () => {
  const cases: [string, string][] = [
    ['Stage en JavaScript et TypeScript', 'JavaScript'],
    ['Développement Python et Java', 'Python'],
    ['Java backend development', 'Java'],
    ['C++ embedded systems', 'C++'],
    ['C# .NET development', 'C#'],
    ['PHP web development', 'PHP'],
    ['Golang microservices', 'Golang'],
    ['React frontend', 'React'],
    ['Angular development', 'Angular'],
    ['Vue.js frontend', 'Vue.js'],
    ['Node.js backend', 'Node.js'],
    ['Next.js application', 'Next.js'],
    ['Django backend', 'Django'],
    ['Spring Boot backend', 'Spring'],
    ['.NET development', '.NET'],
    ['AWS cloud infrastructure', 'AWS'],
    ['Azure cloud services', 'Azure'],
    ['GCP infrastructure', 'GCP'],
    ['Docker containers', 'Docker'],
    ['Kubernetes orchestration', 'Kubernetes'],
    ['Terraform infrastructure as code', 'Terraform'],
    ['SQL databases', 'SQL'],
    ['PostgreSQL database', 'PostgreSQL'],
    ['MySQL database', 'MySQL'],
    ['MongoDB NoSQL', 'MongoDB'],
    ['Linux system administration', 'Linux'],
    ['Git version control', 'Git'],
    ['TensorFlow machine learning', 'TensorFlow'],
    ['PyTorch deep learning', 'PyTorch'],
  ]

  it.each(cases)('detects %s as %s', (text, expected) => {
    expect(classifyTechnologies(text)).toContain(expected)
  })

  it('does not match "Java" inside "JavaScript"', () => {
    expect(classifyTechnologies('JavaScript developer')).not.toContain('Java')
  })

  it('does not match bare "Go" (only "Golang")', () => {
    expect(classifyTechnologies('We go the extra mile for our interns')).not.toContain('Golang')
  })

  it('deduplicates repeated mentions', () => {
    expect(classifyTechnologies('React React React')).toEqual(['React'])
  })

  it('returns an empty array for unrelated text', () => {
    expect(classifyTechnologies('Stage assistant comptable')).toEqual([])
  })
})
