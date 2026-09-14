import { JSDOM } from 'jsdom'

const MAX_DESCRIPTION_LENGTH = 5000
const REMOVE_SELECTORS = ['script', 'style', 'form', 'iframe', 'object', 'embed', 'noscript']

/**
 * Converts hostile external HTML into bounded plain text. Removes entire
 * elements (not just their tags) for script/style/form/embed-like nodes so
 * their *content* never surfaces as visible text either, then reads only
 * `textContent` — event-handler attributes and markup never appear in
 * textContent regardless, so this alone eliminates the whole markup-based
 * attack surface for what we store/render (docs/SECURITY.md).
 */
export function sanitizeDescriptionToPlainText(html: string): string {
  if (!html) return ''
  const dom = new JSDOM(`<body>${html}</body>`)
  const { document } = dom.window
  for (const selector of REMOVE_SELECTORS) {
    document.querySelectorAll(selector).forEach((el) => el.remove())
  }
  const rawText = document.body.textContent ?? ''
  const withoutControlChars = rawText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  const collapsed = withoutControlChars
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return collapsed.slice(0, MAX_DESCRIPTION_LENGTH)
}
