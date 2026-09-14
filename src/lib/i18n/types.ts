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
  }
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
