import type { Dictionary } from '../types'

export const fr = {
  meta: {
    title: 'PFE Finder — Stages informatiques au Maroc et en France',
    description:
      'Recherche de stages informatiques au Maroc et en France, tous types confondus, avec un filtre dédié aux stages de fin d’études (PFE), à partir de sources vérifiées.',
  },
  skipLink: 'Aller au contenu principal',
  nav: {
    home: 'Accueil',
    howItWorks: 'Comment ça marche',
    specialties: 'Spécialités',
  },
  languageSwitch: {
    label: 'Choisir la langue',
    fr: 'Français',
    en: 'English',
  },
  hero: {
    eyebrow: 'Stages informatiques · Maroc & France',
    title: 'Trouvez votre stage informatique, entre le Maroc et la France.',
    description:
      'Une sélection vérifiée de stages en informatique — développement, data, cybersécurité, cloud — publiés directement par les entreprises. Un filtre dédié permet de n’afficher que les stages de fin d’études.',
    ctaPrimary: 'Explorer les offres',
    ctaSecondary: 'Comment ça marche',
    routeFrom: 'Casablanca',
    routeTo: 'Paris',
  },
  howItWorks: {
    title: 'Comment ça marche',
    steps: [
      {
        title: 'Filtrez par pays et spécialité',
        body: 'Maroc, France, ville, technologie, mode de travail — combinez les critères utiles.',
      },
      {
        title: 'Consultez l’offre d’origine',
        body: 'Description normalisée, fraîcheur de la source, lien direct de candidature.',
      },
      {
        title: 'Gardez vos favoris',
        body: 'Enregistrés sur cet appareil, sans compte à créer.',
      },
    ],
  },
  specialties: {
    title: 'Six spécialités informatiques',
    description: 'Classées et vérifiées à partir des offres publiées par les entreprises.',
    items: {
      softwareWebMobile: { label: 'Logiciel / Web / Mobile' },
      dataAi: { label: 'Data / IA' },
      cybersecurity: { label: 'Cybersécurité' },
      cloudDevops: { label: 'Cloud / DevOps' },
      systemsNetworks: { label: 'Systèmes / Réseaux' },
      qaTesting: { label: 'QA / Test' },
    },
  },
  coverage: {
    morocco: {
      code: 'MA',
      body: 'Casablanca, Rabat, Marrakech et au-delà — offres vérifiées auprès d’entreprises présentes au Maroc.',
    },
    france: {
      code: 'FR',
      body: 'Paris, Lyon, Toulouse et au-delà — même exigence de vérification des sources.',
    },
  },
  footer: {
    copyright: '© PFE Finder — projet indépendant, non affilié.',
    attributionNote: 'Sources attribuées sur chaque offre.',
  },
} satisfies Dictionary
