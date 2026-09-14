import { classifySpecialties, type SpecialtySlug } from './dictionaries/specialties'
import { classifyTechnologies } from './dictionaries/technologies'

export interface ClassificationInput {
  title: string
  descriptionText: string
}

export type WorkMode = 'onsite' | 'hybrid' | 'remote' | 'unknown'

export interface ClassificationResult {
  internshipType: 'internship'
  isPfe: boolean
  specialties: SpecialtySlug[]
  technologies: string[]
  workMode: WorkMode
}

const INTERNSHIP_KEYWORDS = /\bstage\b|\bstagiaire\b|\binternship\b|\bintern\b/i
const EXCLUDED_CONTRACT_KEYWORDS =
  /\bcdi\b|\bcdd\b|\bfreelance\b|\bind[ée]pendant\b|\balternance\b|\bapprentissage\b|contrat de professionnalisation|\bwork[- ]study\b|\bfull[- ]time employee\b|\bpermanent position\b/i
const NON_CS_DOMAIN_KEYWORDS =
  /ressources humaines|\bhr\b|human resources|\bmarketing\b|\bcommercial\b|\bventes?\b|\bsales\b|comptabilit[ée]|\baccounting\b/i
const CS_DOMAIN_SIGNAL = /informatique|computer science|ing[ée]nieur logiciel|software engineer|\binformatics\b/i

// docs/PRODUCT.md: is_pfe is true ONLY for these explicit phrases — never
// inferred from duration, education level, or graduation year alone.
// The apostrophe class ['’] is deliberately explicit (not `.`, which would
// match ANY character and wrongly accept e.g. "stage de fin dXétudes").
const PFE_PHRASES =
  /\bpfe\b|stage de fin d['’]?[ée]tudes?|projet de fin d['’]?[ée]tudes?|final[- ]year internship|end[- ]of[- ]studies internship/i

/**
 * Accept/reject gate plus classification for a single posting. Returns
 * `null` when the posting must be rejected (docs/PRODUCT.md: not an
 * internship, or an internship with no substantive computer-science work).
 */
export function classifyPosting(input: ClassificationInput): ClassificationResult | null {
  const text = `${input.title}\n${input.descriptionText}`

  if (!INTERNSHIP_KEYWORDS.test(text)) return null
  if (EXCLUDED_CONTRACT_KEYWORDS.test(text)) return null

  const specialties = classifySpecialties(text)
  const technologies = classifyTechnologies(text)
  const hasCsSignal = specialties.length > 0 || technologies.length > 0 || CS_DOMAIN_SIGNAL.test(text)
  if (!hasCsSignal) return null
  if (NON_CS_DOMAIN_KEYWORDS.test(text) && specialties.length === 0 && technologies.length === 0) return null

  return {
    internshipType: 'internship',
    isPfe: PFE_PHRASES.test(text),
    specialties,
    technologies,
    workMode: classifyWorkMode(text),
  }
}

function classifyWorkMode(text: string): WorkMode {
  if (/t[ée]l[ée]travail|\bremote\b|\bwfh\b|travail [àa] distance/i.test(text)) return 'remote'
  if (/hybride|\bhybrid\b/i.test(text)) return 'hybrid'
  if (/sur site|on[- ]site|pr[ée]sentiel/i.test(text)) return 'onsite'
  return 'unknown'
}
