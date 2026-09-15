export interface DictionaryStep {
  title: string
  body: string
}

export interface DictionarySpecialty {
  label: string
}

export interface DictionaryCoverageItem {
  code: string
  body: string
}

export interface DictionaryWorkModeLabels {
  onsite: string
  hybrid: string
  remote: string
  unknown: string
}

export interface DictionaryOffers {
  pageTitle: string
  pageDescription: string
  filters: {
    heading: string
    searchLabel: string
    searchPlaceholder: string
    countryLabel: string
    countryAny: string
    countryOptions: { MA: string; FR: string }
    cityLabel: string
    cityPlaceholder: string
    specialtyLabel: string
    specialtyAny: string
    technologyLabel: string
    technologyAny: string
    workModeLabel: string
    workModeAny: string
    pfeLabel: string
    languageLabel: string
    languageAny: string
    languageOptions: { fr: string; en: string }
    sortLabel: string
    sortOptions: { newest: string; recentlySeen: string }
    resetLabel: string
    ignoredNotice: string
  }
  workModeLabels: DictionaryWorkModeLabels
  states: {
    loading: string
    empty: string
    error: string
    rateLimited: string
    resultsCount: string
  }
  freshness: {
    staleTitle: string
    staleBody: string
  }
  pagination: {
    loadMore: string
    loadingMore: string
  }
  favorites: {
    add: string
    remove: string
    deviceOnlyNotice: string
  }
  card: {
    pfeBadge: string
    unknownLocation: string
    unknownDate: string
    publishedOn: string
    sourceLabel: string
    viewDetails: string
  }
  detail: {
    backToSearch: string
    descriptionHeading: string
    applyButton: string
    applyUnavailable: string
    sourceHeading: string
    lastVerified: string
    notFoundTitle: string
    notFoundBody: string
    notFoundBackLink: string
  }
}

export interface Dictionary {
  meta: {
    title: string
    description: string
  }
  skipLink: string
  nav: {
    home: string
    howItWorks: string
    specialties: string
    offers: string
  }
  offers: DictionaryOffers
  languageSwitch: {
    label: string
    fr: string
    en: string
  }
  hero: {
    eyebrow: string
    title: string
    description: string
    ctaPrimary: string
    ctaSecondary: string
    routeFrom: string
    routeTo: string
  }
  howItWorks: {
    title: string
    steps: [DictionaryStep, DictionaryStep, DictionaryStep]
  }
  specialties: {
    title: string
    description: string
    items: {
      softwareWebMobile: DictionarySpecialty
      dataAi: DictionarySpecialty
      cybersecurity: DictionarySpecialty
      cloudDevops: DictionarySpecialty
      systemsNetworks: DictionarySpecialty
      qaTesting: DictionarySpecialty
    }
  }
  coverage: {
    morocco: DictionaryCoverageItem
    france: DictionaryCoverageItem
  }
  footer: {
    copyright: string
    attributionNote: string
  }
}
