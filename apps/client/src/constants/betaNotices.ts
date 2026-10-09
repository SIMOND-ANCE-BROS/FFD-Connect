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
