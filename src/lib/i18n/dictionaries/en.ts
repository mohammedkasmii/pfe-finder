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
    offers: 'Offers',
  },
  offers: {
    pageTitle: 'Search internships',
    pageDescription: 'Filter verified computer science internship offers in Morocco and France.',
    filters: {
      heading: 'Filters',
      searchLabel: 'Search',
      searchPlaceholder: 'Title, company, or city',
      countryLabel: 'Country',
      countryAny: 'All countries',
      countryOptions: { MA: 'Morocco', FR: 'France' },
      cityLabel: 'City',
      cityPlaceholder: 'e.g. Casablanca',
      specialtyLabel: 'Specialty',
      specialtyAny: 'All specialties',
      technologyLabel: 'Technology',
      technologyAny: 'All technologies',
      workModeLabel: 'Work mode',
      workModeAny: 'All modes',
      pfeLabel: 'Final-year internships (PFE) only',
      languageLabel: 'Offer language',
      languageAny: 'All languages',
      languageOptions: { fr: 'French', en: 'English' },
      sortLabel: 'Sort by',
      sortOptions: { newest: 'Newest', recentlySeen: 'Recently seen' },
      resetLabel: 'Reset filters',
      ignoredNotice: 'Some filters in the address were invalid and were ignored.',
    },
    workModeLabels: {
      onsite: 'On-site',
      hybrid: 'Hybrid',
      remote: 'Remote',
      unknown: 'Unspecified',
    },
    states: {
      loading: 'Loading offers…',
      empty: 'No offers match these criteria.',
      error: 'Offers could not be loaded right now. Try again later.',
      rateLimited: 'Too many requests. Please try again shortly.',
      resultsCount: '{count} offer(s) found',
    },
    freshness: {
      staleTitle: 'Data may be out of date',
      staleBody: 'No verified source has updated in over 48 hours. Offers shown may be stale.',
    },
    pagination: {
      loadMore: 'Load more offers',
      loadingMore: 'Loading…',
    },
    favorites: {
      add: 'Add to favorites',
      remove: 'Remove from favorites',
      deviceOnlyNotice: 'Favorites are saved only on this device.',
    },
    card: {
      pfeBadge: 'PFE',
      unknownLocation: 'Location unspecified',
      unknownDate: 'Date unknown',
      publishedOn: 'Published {date}',
      sourceLabel: 'Source: {name}',
      viewDetails: 'View offer',
    },
    detail: {
      backToSearch: 'Back to search',
      descriptionHeading: 'Description',
      applyButton: 'Apply',
      applyUnavailable: 'The application link is not available for this offer.',
      sourceHeading: 'Source',
      lastVerified: 'Last verified: {date}',
      notFoundTitle: 'Offer not found',
      notFoundBody: 'This offer does not exist or is no longer available.',
      notFoundBackLink: 'Back to offers',
    },
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
