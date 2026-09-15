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

// Title-only seniority/experienced-role rejection — checked BEFORE the
// provider's own experienceLevel signal (below), because SmartRecruiters
// can mislabel an obviously senior role as experienceLevel.id="internship"
// (confirmed production false positives: SmartRecruiters ID 744000114931649
// "Fullstack Java/Angular - Sénior" and ID 744000100201445 "LEAD IA &
// AGENTIC (H/F) (SENIOR)", both experienceLevel.id="internship"). An
// obviously senior title must never be overridden by erroneous provider
// metadata. Deliberately narrow: "lead" alone is NOT matched (that would
// reject an unrelated title like "... lead generation platform") — it only
// counts when paired with a role noun ("Lead IA"/"AI Lead"/"Tech
// Lead"/"Lead Developer"/"Lead Engineer").
const SENIORITY_TITLE_KEYWORDS =
  /\bs[ée]nior\b|\bconfirm[ée]e?\b|\bmanager\b|\bdirector\b|\bdirecteur\b|\bdirectrice\b|\bhead of\b|\bexecutive\b|\blead\s+(ia|ai|d[ée]veloppeurs?|developers?|ing[ée]nieurs?|engineers?)\b|\b(tech|ai|ia)[\s-]lead\b/i

function isSeniorTitle(title: string): boolean {
  return SENIORITY_TITLE_KEYWORDS.test(title)
}

// Known SmartRecruiters experienceLevel.id values that authoritatively mean
// "not an internship" (production review: confirmed false positive
// SmartRecruiters ID 744000093240108 has experienceLevel.id="associate").
// Illustrative, not exhaustive — an id NOT in this set is treated as
// NEUTRAL (see experienceLevelSignal below), never automatically negative,
// since "not_applicable"/"entry_level"/missing/unknown values are common on
// genuine internship postings too (confirmed valid PFE listings
// 744000103015093/744000101894557 both have experienceLevel.id="not_applicable").
const NEGATIVE_EXPERIENCE_LEVEL_IDS = new Set(['associate', 'mid_senior_level', 'director', 'executive'])

type ExperienceLevelSignal = 'positive' | 'negative' | 'neutral'

/**
 * Classifies the source's own `experienceLevel.id`, when supplied, into
 * three buckets:
 *   - "positive": explicitly "internship" — authoritative, overrides
 *     everything else (a role can be accepted even with no internship
 *     keyword anywhere in its title).
 *   - "negative": a known senior/permanent-track id — authoritative
 *     rejection, regardless of title/description content.
 *   - "neutral": absent, "not_applicable", "entry_level", or any other
 *     unrecognized value — no signal either way; the TITLE's own
 *     internship keyword decides (see classifyPosting).
 */
function experienceLevelSignal(experienceLevelId: string | undefined): ExperienceLevelSignal {
  if (!experienceLevelId) return 'neutral'
  const id = experienceLevelId.toLowerCase()
  if (id === 'internship') return 'positive'
  if (NEGATIVE_EXPERIENCE_LEVEL_IDS.has(id)) return 'negative'
  return 'neutral'
}

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

  // Checked first, before any experienceLevel signal: see
  // SENIORITY_TITLE_KEYWORDS's doc comment above.
  if (isSeniorTitle(input.title)) return null

  // Internship-role identification: combines the source's own structured
  // experience-level field (far more reliable than free text — "stage de
  // fin d'études" can appear incidentally inside a PERMANENT role's
  // required-experience qualifications) with an explicit internship
  // keyword in the TITLE specifically (never the description/qualifications
  // — production review: a permanent consultant role whose QUALIFICATIONS
  // merely required prior internship experience, SmartRecruiters ID
  // 744000093240108, must stay rejected even with neutral/missing
  // experience-level metadata).
  //   - "positive" (experienceLevel.id="internship"): authoritative — the
  //     role is accepted through to CS classification regardless of title
  //     wording (a genuine CS internship need not say "stage" in its title).
  //   - "negative" (a known senior id): authoritative rejection.
  //   - "neutral" (absent/"not_applicable"/"entry_level"/unknown): no
  //     signal either way — an internship keyword in the TITLE is then
  //     required to continue (confirmed valid PFE listings 744000103015093/
  //     744000101894557 both have experienceLevel.id="not_applicable" with
  //     "Stagiaire" in the title).
  const expSignal = experienceLevelSignal(input.experienceLevelId)
  if (expSignal === 'negative') return null
  if (expSignal !== 'positive' && !INTERNSHIP_KEYWORDS.test(input.title)) return null

  if (EXCLUDED_CONTRACT_KEYWORDS.test(text)) return null

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
