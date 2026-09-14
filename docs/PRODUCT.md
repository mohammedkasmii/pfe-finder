# Product specification

## Goal and audience

PFE Finder helps computer science students find internships in Morocco and France from a small set of reliable sources. The initial audience is the project owner's friends, using a public Vercel deployment on desktop and mobile.

## V1 experience

- French is the default interface language. A persistent control switches the interface to English.
- Source titles and descriptions stay in their original language.
- Users can search title, company, city, specialty, and technology.
- Filters cover country (`MA`, `FR`), city, specialty, technology, work mode, and PFE status.
- Specialties are: Software/Web/Mobile, Data/AI, Cybersecurity, Cloud/DevOps, Systems/Networks, and QA/Testing.
- Work modes are: On-site, Hybrid, Remote, and Unknown.
- Filters are represented in the URL and survive reloads. Invalid values are ignored safely.
- Results default to newest first and use cursor pagination.
- An offer card shows title, company, location, work mode, specialties, technologies, PFE badge when applicable, publication date when known, and source.
- An offer page shows the normalized plain-text description, freshness information, source attribution, and an HTTPS application link.
- Favorites are stored in browser local storage. The UI states that they are available only on the current device.
- Empty, loading, source-stale, and service-error states are understandable in both languages.

## Classification

- Include internships with substantive computer science work.
- Exclude HR, sales, marketing, general finance, and other unrelated roles even when the title contains “stage”.
- Exclude permanent employment, freelance work, apprenticeships, and work-study roles.
- `is_pfe` is true only when title or description explicitly contains PFE, stage de fin d'études, final-year internship, end-of-studies internship, or a documented equivalent.
- A six-month duration or final-year education requirement alone does not set `is_pfe`.

## Accessibility and quality

- Support keyboard-only operation and visible focus states.
- Associate every input with a label and expose result updates to assistive technology.
- Meet WCAG AA color contrast for text and controls.
- Avoid layout overflow at 320 CSS pixels and support current Chrome, Edge, Firefox, and Safari.

## Acceptance

The launch is acceptable when real, relevant offers appear from both countries; combined filters and shareable URLs work; favorites survive reloads; bilingual navigation is complete; and stale or failed sources are reported without losing existing offers.
