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
    offers: 'Offres',
  },
  offers: {
    pageTitle: 'Rechercher un stage',
    pageDescription: 'Filtrez les offres de stage informatique vérifiées au Maroc et en France.',
    filters: {
      heading: 'Filtres',
      searchLabel: 'Rechercher',
      searchPlaceholder: 'Titre, entreprise ou ville',
      countryLabel: 'Pays',
      countryAny: 'Tous les pays',
      countryOptions: { MA: 'Maroc', FR: 'France' },
      cityLabel: 'Ville',
      cityPlaceholder: 'Ex. Casablanca',
      specialtyLabel: 'Spécialité',
      specialtyAny: 'Toutes les spécialités',
      technologyLabel: 'Technologie',
      technologyAny: 'Toutes les technologies',
      workModeLabel: 'Mode de travail',
      workModeAny: 'Tous les modes',
      pfeLabel: 'Stages de fin d’études (PFE) uniquement',
      languageLabel: 'Langue de l’offre',
      languageAny: 'Toutes les langues',
      languageOptions: { fr: 'Français', en: 'Anglais' },
      sortLabel: 'Trier par',
      sortOptions: { newest: 'Plus récentes', recentlySeen: 'Vues récemment' },
      resetLabel: 'Réinitialiser les filtres',
      ignoredNotice: 'Certains filtres de l’adresse n’étaient pas valides et ont été ignorés.',
    },
    workModeLabels: {
      onsite: 'Sur site',
      hybrid: 'Hybride',
      remote: 'Télétravail',
      unknown: 'Non précisé',
    },
    states: {
      loading: 'Chargement des offres…',
      empty: 'Aucune offre ne correspond à ces critères.',
      error: 'Impossible de charger les offres pour le moment. Réessayez plus tard.',
      rateLimited: 'Trop de requêtes. Merci de réessayer dans un instant.',
      resultsCount: '{count} offre(s) trouvée(s)',
    },
    freshness: {
      staleTitle: 'Données peut-être obsolètes',
      staleBody: 'Aucune source vérifiée n’a été mise à jour depuis plus de 48 heures. Les offres affichées peuvent être anciennes.',
    },
    pagination: {
      loadMore: 'Voir plus d’offres',
      loadingMore: 'Chargement…',
    },
    favorites: {
      add: 'Ajouter aux favoris',
      remove: 'Retirer des favoris',
      deviceOnlyNotice: 'Les favoris sont enregistrés uniquement sur cet appareil.',
    },
    card: {
      pfeBadge: 'PFE',
      unknownLocation: 'Lieu non précisé',
      unknownDate: 'Date inconnue',
      publishedOn: 'Publiée le {date}',
      sourceLabel: 'Source : {name}',
      viewDetails: 'Voir l’offre',
    },
    detail: {
      backToSearch: 'Retour à la recherche',
      descriptionHeading: 'Description',
      applyButton: 'Postuler',
      applyUnavailable: 'Le lien de candidature n’est pas disponible pour cette offre.',
      sourceHeading: 'Source',
      lastVerified: 'Dernière vérification : {date}',
      notFoundTitle: 'Offre introuvable',
      notFoundBody: 'Cette offre n’existe pas ou n’est plus disponible.',
      notFoundBackLink: 'Retour aux offres',
    },
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
