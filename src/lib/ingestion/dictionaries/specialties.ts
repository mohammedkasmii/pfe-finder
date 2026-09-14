export const SPECIALTIES_DICTIONARY_VERSION = 1

// The six specialties documented in docs/PRODUCT.md.
export const SPECIALTY_SLUGS = [
  'software-web-mobile',
  'data-ai',
  'cybersecurity',
  'cloud-devops',
  'systems-networks',
  'qa-testing',
] as const
export type SpecialtySlug = (typeof SPECIALTY_SLUGS)[number]

const SPECIALTY_PATTERNS: Record<SpecialtySlug, RegExp> = {
  'software-web-mobile':
    /d[ée]veloppeur|d[ée]veloppement (web|mobile|logiciel)|developer|software engineer|full[- ]stack|front[- ]?end|back[- ]?end|application mobile|mobile app|ing[ée]nieur logiciel/i,
  'data-ai':
    /data scientist|data analyst|data engineer|machine learning|deep learning|intelligence artificielle|artificial intelligence|\bia\b|\bml\b|big data|\bnlp\b|computer vision/i,
  cybersecurity:
    /cybers[ée]curit[ée]|s[ée]curit[ée] informatique|pentest|security engineer|soc analyst|infosec|ethical hack/i,
  'cloud-devops':
    /devops|cloud engineer|kubernetes|\bdocker\b|\baws\b|\bazure\b|\bgcp\b|infrastructure as code|terraform|ci\/cd|\bsre\b/i,
  'systems-networks':
    /syst[èe]mes?\s*(et|\/)?\s*r[ée]seaux|network engineer|administrateur syst[èe]me|sysadmin|infrastructure r[ée]seau|t[ée]l[ée]com/i,
  'qa-testing':
    /\bqa\b|quality assurance|test(eur|euse|ing)? logiciel|test automation|assurance qualit[ée]/i,
}

export function classifySpecialties(text: string): SpecialtySlug[] {
  return SPECIALTY_SLUGS.filter((slug) => SPECIALTY_PATTERNS[slug].test(text))
}
