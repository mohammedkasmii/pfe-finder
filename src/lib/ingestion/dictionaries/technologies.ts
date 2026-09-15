export const TECHNOLOGIES_DICTIONARY_VERSION = 1

interface TechnologyEntry {
  canonical: string
  pattern: RegExp
}

// Deliberately excludes bare "Go" (too ambiguous against the English verb
// "go"); only the unambiguous "Golang" spelling is matched. Documented
// limitation rather than a false-positive risk.
const TECHNOLOGIES: TechnologyEntry[] = [
  { canonical: 'JavaScript', pattern: /\bjavascript\b/i },
  { canonical: 'TypeScript', pattern: /\btypescript\b/i },
  { canonical: 'Python', pattern: /\bpython\b/i },
  { canonical: 'Java', pattern: /\bjava\b(?!script)/i },
  { canonical: 'C++', pattern: /c\+\+/i },
  { canonical: 'C#', pattern: /c#/i },
  { canonical: 'PHP', pattern: /\bphp\b/i },
  { canonical: 'Golang', pattern: /\bgolang\b/i },
  { canonical: 'React', pattern: /\breact(\.js)?\b/i },
  { canonical: 'Angular', pattern: /\bangular\b/i },
  { canonical: 'Vue.js', pattern: /\bvue(\.js)?\b/i },
  { canonical: 'Node.js', pattern: /\bnode(\.js)?\b/i },
  { canonical: 'Next.js', pattern: /\bnext\.js\b/i },
  { canonical: 'Django', pattern: /\bdjango\b/i },
  { canonical: 'Spring', pattern: /\bspring( boot)?\b/i },
  { canonical: '.NET', pattern: /\.net\b/i },
  { canonical: 'AWS', pattern: /\baws\b|amazon web services/i },
  { canonical: 'Azure', pattern: /\bazure\b/i },
  { canonical: 'GCP', pattern: /\bgcp\b|google cloud/i },
  { canonical: 'Docker', pattern: /\bdocker\b/i },
  { canonical: 'Kubernetes', pattern: /\bkubernetes\b|\bk8s\b/i },
  { canonical: 'Terraform', pattern: /\bterraform\b/i },
  { canonical: 'SQL', pattern: /\bsql\b/i },
  { canonical: 'PostgreSQL', pattern: /\bpostgres(ql)?\b/i },
  { canonical: 'MySQL', pattern: /\bmysql\b/i },
  { canonical: 'MongoDB', pattern: /\bmongodb\b/i },
  { canonical: 'Linux', pattern: /\blinux\b/i },
  { canonical: 'Git', pattern: /\bgit\b/i },
  { canonical: 'TensorFlow', pattern: /\btensorflow\b/i },
  { canonical: 'PyTorch', pattern: /\bpytorch\b/i },
]

export function classifyTechnologies(text: string): string[] {
  const matched = TECHNOLOGIES.filter((entry) => entry.pattern.test(text)).map((entry) => entry.canonical)
  return Array.from(new Set(matched))
}

/** Every canonical technology name this dictionary can produce — used to
 * populate the `technology` filter's dropdown (src/components/offers/filters-panel.tsx)
 * so a filter value always matches a real, exactly-cased array entry. */
export const TECHNOLOGY_NAMES: readonly string[] = TECHNOLOGIES.map((entry) => entry.canonical)
