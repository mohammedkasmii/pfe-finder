import { classifySpecialties, type SpecialtySlug } from './dictionaries/specialties'
import { classifyTechnologies } from './dictionaries/technologies'

export interface ClassificationInput {
  title: string
  descriptionText: string
  /**
   * The source's own structured experience-level identifier (e.g.
   * SmartRecruiters' `experienceLevel.id`), when supplied — trusted,
   * normalized provider metadata, never inferred from free text. See the
   * experience-level gate in `classifyPosting` below.
   */
  experienceLevelId?: string
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

// Title-level, unconditional exclusion (Codex review: a full-text scan for
// bare domain words like "ESG"/"RSE"/"sustainability"/"customer engagement"
// would also hide a genuine CS internship whose DESCRIPTION merely mentions
// building software *for* one of these domains — e.g. "Stage développeur
// TypeScript — plateforme RSE/ESG" or "Software engineering internship —
// customer engagement platform"). A role's TITLE naming a non-CS function
// outright is a much stronger, much lower-false-positive signal, so this
// gate checks ONLY the title, never the description, and applies no
// specialty/technology override. It still requires an actual non-CS ROLE
// pattern — not a bare topic/domain word — which is why the
// sustainability/ESG/RSE category additionally requires an audit/consulting
// role word in the same title (confirmed false positive: SmartRecruiters ID
// 744000148448799, "Sustainability Audit & Consulting").
const HARD_EXCLUDE_CUSTOMER_ENGAGEMENT_TITLE = /activation client|charg[ée](\(e\))?\s+de\s+l['’]?engagement/i
const HARD_EXCLUDE_BUSINESS_FUNCTION_TITLE =
  /\bmarketing\b|\bcommercial\b|\bventes?\b|\bsales\b|ressources humaines|\bhr\b|human resources|comptabilit[ée]|\baccounting\b/i
const SUSTAINABILITY_DOMAIN_WORDS = /durabilit[ée]|\bsustainability\b|\bESG\b|\bRSE\b/i
const AUDIT_CONSULTING_ROLE_WORDS = /\baudit\b|\bconsult(ing|ant)?\b|\bconseil\b/i

/**
 * True only for a TITLE that names one of three confirmed non-CS role
 * patterns outright (customer engagement/client activation; marketing,
 * sales, HR, accounting, or commercial; sustainability/ESG/RSE audit or
 * consulting). A description mentioning any of these domains never reaches
 * this function — see `classifyPosting`.
 */
function isHardExcludedTitle(title: string): boolean {
  if (HARD_EXCLUDE_CUSTOMER_ENGAGEMENT_TITLE.test(title)) return true
  if (HARD_EXCLUDE_BUSINESS_FUNCTION_TITLE.test(title)) return true
  if (SUSTAINABILITY_DOMAIN_WORDS.test(title) && AUDIT_CONSULTING_ROLE_WORDS.test(title)) return true
  return false
}

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

  // The source's own structured experience-level field is far more
  // reliable than free text: "stage de fin d'études" can appear
  // incidentally inside a PERMANENT role's required-experience
  // qualifications (confirmed production false positive: SmartRecruiters
  // ID 744000093240108, experienceLevel.id="associate",
  // typeOfEmployment.id="permanent"). typeOfEmployment is deliberately
  // NOT checked here: a confirmed valid PFE listing (ID 744000116903752)
  // has typeOfEmployment.id="permanent" with experienceLevel.id="internship".
  if (input.experienceLevelId && input.experienceLevelId.toLowerCase() !== 'internship') return null

  // Title-only hard exclusion — see isHardExcludedTitle's doc comment.
  // Checked before any specialty/technology/CS-signal detection, and
  // unconditional (no override), but scoped to the title alone so a
  // description merely mentioning one of these domains can never reject a
  // genuine CS internship.
  if (isHardExcludedTitle(input.title)) return null

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
