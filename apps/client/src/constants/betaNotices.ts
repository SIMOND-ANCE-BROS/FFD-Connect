/**
 * Beta independence notices.
 *
 * The beta is not connected to the federation's systems yet: accounts,
 * competition registrations and the displayed license are specific to the
 * app. These texts make that explicit on the screens where testers got
 * confused. They are centralised here so they can be removed in one place
 * once the app is connected to the federation (delete this file and the
 * `BetaNotice` usages the compiler then points to).
 *
 * User-facing copy is in French. Never suggest that the app is official or
 * endorsed by the federation.
 */
export interface BetaNoticeCopy {
  title: string;
  message: string;
}

export const BETA_NOTICES = {
  login: {
    title: "Version bêta indépendante",
    message:
      "L'app n'est pas encore reliée à la FFD. Vos identifiants de l'espace licencié FFD ne fonctionnent pas ici : créez un compte avec votre numéro de licence, puis connectez-vous avec l'e-mail et le mot de passe choisis.",
  },
  register: {
    title: "Version bêta indépendante",
    message:
      "L'app n'est pas encore reliée à la FFD : ce compte est propre à l'app. Votre numéro de licence sert à vous identifier ; vous vous connecterez ensuite avec l'e-mail et le mot de passe choisis ci-dessous.",
  },
  competitions: {
    title: "Informations à titre indicatif",
    message:
      "L'app n'est pas encore reliée aux inscriptions FFD : vos inscriptions n'apparaissent pas ici.",
  },
  license: {
    title: "Licence affichée à titre informatif",
    message:
      "Elle n'est pas encore recevable en compétition. Présentez votre licence officielle FFD.",
  },
  /** Extra line under the « Pour moi » empty state of the competitions list. */
  competitionsEmptyHint:
    "Vos inscriptions faites auprès de la FFD n'apparaissent pas encore dans l'app.",
} as const satisfies Record<string, BetaNoticeCopy | string>;

/**
 * Notices about the origin of a competition's events (épreuves), shown on the
 * competition detail screen. Chosen by `getEventsSourceNotice` from the
 * backend `eventsSource` + `circularUrl`. Temporary: they go away once the
 * events come from a structured federation source.
 */
export const EVENTS_SOURCE_NOTICES = {
  /** Events deduced from the circular PDF. */
  deducedFromCircular: {
    title: "Épreuves à vérifier",
    message:
      "Catégories déduites automatiquement de la circulaire FFD : à vérifier sur le document officiel.",
  },
  /** Events deduced from the competition description. */
  deducedFromDescription: {
    title: "Épreuves à vérifier",
    message:
      "Catégories déduites automatiquement de la description FFD de la compétition : à vérifier sur la circulaire officielle.",
  },
  /** A circular exists but its events could not be read. */
  circularUnreadable: {
    title: "Épreuves non disponibles",
    message:
      "Les épreuves n'ont pas pu être lues automatiquement : consultez la circulaire.",
  },
  /** No circular published yet. */
  notYetPublished: {
    title: "Épreuves non disponibles",
    message:
      "Les épreuves ne sont pas encore disponibles dans les documents officiels de la FFD. Elles s'afficheront ici dès la publication de la circulaire.",
  },
  /** Label of the button that opens the circular. */
  openCircular: "Ouvrir la circulaire",
} as const satisfies Record<string, BetaNoticeCopy | string>;
