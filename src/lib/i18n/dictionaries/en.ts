import type { Dictionary } from '../types'

export const en = {
  meta: {
    title: 'PFE Finder — Computer science internships in Morocco and France',
    description:
      'Search computer science internships in Morocco and France, all types included, with a dedicated filter for final-year (PFE) internships, drawn from verified sources.',
  },
  skipLink: 'Skip to main content',
  nav: {
    home: 'Home',
    howItWorks: 'How it works',
    specialties: 'Specialties',
  },
  languageSwitch: {
    label: 'Choose language',
    fr: 'Français',
    en: 'English',
  },
  hero: {
    eyebrow: 'Computer science internships · Morocco & France',
    title: 'Find your computer science internship, between Morocco and France.',
    description:
      'A verified selection of computer science internships — development, data, cybersecurity, cloud — published directly by companies. A dedicated filter narrows results to final-year internships only.',
    ctaPrimary: 'Explore offers',
    ctaSecondary: 'How it works',
    routeFrom: 'Casablanca',
    routeTo: 'Paris',
  },
  howItWorks: {
    title: 'How it works',
    steps: [
      {
        title: 'Filter by country and specialty',
        body: 'Morocco, France, city, technology, work mode — combine the criteria that matter.',
      },
      {
        title: 'Check the original posting',
        body: 'Normalized description, source freshness, and a direct application link.',
      },
      {
        title: 'Keep your favorites',
        body: 'Saved on this device, no account required.',
      },
    ],
  },
  specialties: {
    title: 'Six computer science specialties',
    description: 'Classified and verified from offers published by companies.',
    items: {
      softwareWebMobile: { label: 'Software / Web / Mobile' },
      dataAi: { label: 'Data / AI' },
      cybersecurity: { label: 'Cybersecurity' },
      cloudDevops: { label: 'Cloud / DevOps' },
      systemsNetworks: { label: 'Systems / Networks' },
      qaTesting: { label: 'QA / Testing' },
    },
  },
  coverage: {
    morocco: {
      code: 'MA',
      body: 'Casablanca, Rabat, Marrakech and beyond — offers verified against companies present in Morocco.',
    },
    france: {
      code: 'FR',
      body: 'Paris, Lyon, Toulouse and beyond — the same standard of source verification.',
    },
  },
  footer: {
    copyright: '© PFE Finder — independent project, not affiliated.',
    attributionNote: 'Sources are attributed on every offer.',
  },
} satisfies Dictionary
