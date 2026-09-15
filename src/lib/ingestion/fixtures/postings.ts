export interface PostingFixture {
  description: string
  title: string
  descriptionHtml: string
  expectAccepted: boolean
  expectIsPfe?: boolean
  /** SmartRecruiters' own `experienceLevel.id`, when the fixture needs to
   * exercise that gate (see classification.ts). Omitted fixtures behave as
   * if the source never supplied the field. */
  experienceLevelId?: string
}

/**
 * Documented fixtures for classification (src/lib/ingestion/classification.ts)
 * covering: French, English, positive cases, negative cases, hostile HTML,
 * ambiguous roles, Morocco, and France (per M2's brief). Malformed-URL
 * coverage lives in src/lib/ingestion/urls.test.ts instead — URL validation
 * is a separate concern from title/description classification.
 */
export const POSTING_FIXTURES: PostingFixture[] = [
  {
    description: 'FR, clear CS internship, no PFE phrase',
    title: 'Stage Développeur Full Stack (H/F)',
    descriptionHtml: '<p>Stage de 6 mois en développement web avec React et Node.js.</p>',
    expectAccepted: true,
    expectIsPfe: false,
  },
  {
    description: 'FR, explicit PFE phrase',
    title: 'Stage de fin d’études — Data Engineer',
    descriptionHtml: '<p>Stage de fin d’études en ingénierie de la donnée, Python et SQL.</p>',
    expectAccepted: true,
    expectIsPfe: true,
  },
  {
    description: 'EN, explicit final-year internship phrase',
    title: 'Final-Year Internship — Cloud Engineer',
    descriptionHtml: '<p>Final-year internship working on AWS and Kubernetes infrastructure.</p>',
    expectAccepted: true,
    expectIsPfe: true,
  },
  {
    description: 'EN, CS internship, no PFE phrase',
    title: 'Software Engineering Intern',
    descriptionHtml: '<p>Internship building backend services in Java and PostgreSQL.</p>',
    expectAccepted: true,
    expectIsPfe: false,
  },
  {
    description: 'FR, six-month duration alone must NOT imply PFE',
    title: 'Stage Développeur',
    descriptionHtml: '<p>Stage de six mois en développement logiciel, niveau bac+5.</p>',
    expectAccepted: true,
    expectIsPfe: false,
  },
  {
    description: 'FR, final-year education level alone must NOT imply PFE',
    title: 'Stage QA',
    descriptionHtml: '<p>Stage de test logiciel ouvert aux étudiants en dernière année.</p>',
    expectAccepted: true,
    expectIsPfe: false,
  },
  {
    description: 'HR internship rejected even though titled "stage"',
    title: 'Stage Ressources Humaines',
    descriptionHtml: '<p>Stage au sein du service ressources humaines, recrutement et paie.</p>',
    expectAccepted: false,
  },
  {
    description: 'Marketing internship rejected even though titled "stage"',
    title: 'Stage Marketing Digital',
    descriptionHtml: '<p>Stage marketing, gestion des réseaux sociaux et campagnes publicitaires.</p>',
    expectAccepted: false,
  },
  {
    description: 'Permanent CDI role rejected outright',
    title: 'Développeur Full Stack (CDI)',
    descriptionHtml: '<p>Poste en CDI, développement web avec React.</p>',
    expectAccepted: false,
  },
  {
    description: 'Apprenticeship rejected outright',
    title: 'Alternance Développeur',
    descriptionHtml: '<p>Contrat d’apprentissage en développement logiciel.</p>',
    expectAccepted: false,
  },
  {
    description: 'Freelance role rejected outright',
    title: 'Développeur Freelance',
    descriptionHtml: '<p>Mission freelance de développement, indépendant.</p>',
    expectAccepted: false,
  },
  {
    description: 'Ambiguous role with no CS or domain signal, rejected',
    title: 'Stage Assistant Polyvalent',
    descriptionHtml: '<p>Stage généraliste, tâches administratives variées.</p>',
    expectAccepted: false,
  },
  {
    description: 'Hostile HTML: script/style/tracking must be stripped before classification still succeeds',
    title: 'Stage Développeur Mobile',
    descriptionHtml:
      '<script>alert(1)</script><style>body{color:red}</style><p onclick="steal()">Stage développement mobile Android/iOS.</p><img src="https://track.example.com/pixel.gif?utm_source=x">',
    expectAccepted: true,
    expectIsPfe: false,
  },
  {
    description: 'Morocco-flavored posting',
    title: 'Stage PFE Cybersécurité — Casablanca',
    descriptionHtml: '<p>PFE en cybersécurité, pentest et sécurité informatique, basé à Casablanca.</p>',
    expectAccepted: true,
    expectIsPfe: true,
  },
  {
    description: 'France-flavored posting',
    title: 'Stage DevOps — Paris',
    descriptionHtml: '<p>Stage DevOps, Docker, Kubernetes, CI/CD, basé à Paris.</p>',
    expectAccepted: true,
    expectIsPfe: false,
  },
  {
    description:
      'Confirmed valid PFE listing (SmartRecruiters ID 744000116903752): experienceLevel="internship" with typeOfEmployment="permanent" must still be accepted',
    title: 'Stage PFE Développeur Full Stack',
    descriptionHtml: '<p>Stage de fin d’études en développement web avec React et Node.js.</p>',
    experienceLevelId: 'internship',
    expectAccepted: true,
    expectIsPfe: true,
  },
  {
    description:
      'Production false positive (SmartRecruiters ID 744000093240108): permanent consultant role mentioning "stage de fin d\'études" only as a prior-experience qualification, experienceLevel="associate"',
    title: 'Consultant confirmé - Stratégie et Transformation - Data & IA F/H',
    descriptionHtml:
      '<p>Nous recherchons un consultant confirmé pour renforcer notre practice Data & IA.</p><p>Qualifications : vous avez réalisé un stage de fin d’études ou une première expérience réussie en conseil, idéalement sur des sujets data/IA.</p>',
    experienceLevelId: 'associate',
    expectAccepted: false,
  },
  {
    description:
      'Production false positive (SmartRecruiters ID 744000130014789): customer-engagement/marketing internship for a business-school profile, incidental GCP mention must not make it a CS internship',
    title: 'Stage Chargé(e) de l’Engagement & activation Client - H/F',
    descriptionHtml:
      '<p>Stage au sein de l’équipe marketing client, en charge de l’activation client et de l’engagement sur nos campagnes.</p><p>Profil recherché : étudiant(e) en école de commerce, à l’aise avec les outils digitaux (nous utilisons notamment GCP pour le reporting).</p>',
    experienceLevelId: 'internship',
    expectAccepted: false,
  },
  {
    description:
      'Production false positive (SmartRecruiters ID 744000148448799): sustainability/ESG audit internship for business/finance profiles, generic "data"/"outils informatiques"/Excel/reporting must not make it a CS internship',
    title: 'Stage de Fin d’études - Sustainability Audit & Consulting',
    descriptionHtml:
      '<p>Stage de fin d’études au sein de notre équipe RSE, dédiée à l’audit de durabilité (ESG) pour nos clients grands comptes.</p><p>Vous exploiterez des données (data) issues de nos outils informatiques internes et produirez des reportings Excel pour nos clients.</p>',
    experienceLevelId: 'internship',
    expectAccepted: false,
  },
  {
    description:
      'Confirmed valid PFE listing wrongly deactivated (SmartRecruiters ID 744000103015093, "Stagiaire PFE en SAP HYBRIS"): experienceLevel="not_applicable" (neutral) with a "Stagiaire" title keyword must still be accepted',
    title: 'Stagiaire PFE en SAP HYBRIS',
    descriptionHtml:
      '<p>Stage de fin d’études au sein de l’équipe informatique, paramétrage et développement sur la plateforme e-commerce SAP HYBRIS.</p>',
    experienceLevelId: 'not_applicable',
    expectAccepted: true,
    expectIsPfe: true,
  },
  {
    description:
      'Confirmed valid PFE listing wrongly deactivated (SmartRecruiters ID 744000101894557, "Stagiaire PFE en SAP ARIBA"): experienceLevel="not_applicable" (neutral) with a "Stagiaire" title keyword must still be accepted',
    title: 'Stagiaire PFE en SAP ARIBA',
    descriptionHtml:
      '<p>Stage de fin d’études au sein de l’équipe informatique, paramétrage et intégration de la solution achats SAP ARIBA.</p>',
    experienceLevelId: 'not_applicable',
    expectAccepted: true,
    expectIsPfe: true,
  },
]
