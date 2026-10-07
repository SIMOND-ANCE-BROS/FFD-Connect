import { NotificationType, UserRole } from "@prisma/client";

/**
 * Description d'un type de notification : son comportement par défaut et la
 * copie affichée dans l'écran de réglages.
 *
 * Les libellés vivent ici, et pas dans le client, pour que les types ajoutés
 * plus tard (paiement, modération…) deviennent réglables sans publier une
 * nouvelle version de l'application mobile — la latence de revue de l'App Store
 * rendrait sinon tout ajout de type coûteux.
 */
export interface NotificationTypeDefinition {
  /**
   * Comportement d'un compte qui n'a JAMAIS touché à ses réglages : il n'a
   * aucune ligne `NotificationPreference`, et c'est le cas normal.
   *
   * La règle appliquée dans tout le catalogue : `true` (opt-out) quand la
   * notification porte sur le dossier de l'utilisateur ou appelle une action de
   * sa part, `false` (opt-in) quand elle relève de la diffusion — un même
   * message envoyé à une population parce qu'elle y est éligible, pas parce que
   * l'événement la concerne personnellement.
   */
  readonly defaultEnabled: boolean;
  /**
   * `false` retire le type du catalogue renvoyé par l'API et le rend
   * inconditionnellement envoyé. Réservé aux notifications que l'utilisateur
   * déclenche lui-même : les filtrer n'offrirait aucun confort et casserait
   * leur raison d'être.
   */
  readonly configurable: boolean;
  /**
   * Rôles auxquels ce type s'adresse, et donc seuls à qui l'interrupteur est
   * proposé (`GET /notifications/preferences`) et seuls autorisés à l'écrire.
   *
   * N'est PAS un choix de produit : chaque périmètre est recopié du `where` du
   * producteur. Un rôle absent d'ici ne peut, par construction, jamais recevoir
   * la notification — lui montrer l'interrupteur serait lui promettre un
   * réglage sans effet.
   *
   * Le rôle gouverne ce qui est RÉGLABLE, jamais ce qui est ENVOYÉ : l'envoi ne
   * consulte que la préférence stockée (cf. `isPushEnabled`). Sans ça, un
   * changement de rôle ferait disparaître des notifications sans que la
   * personne puisse le relier à quoi que ce soit.
   */
  readonly roles: readonly UserRole[];
  /** Libellé court de l'interrupteur, en français (copie utilisateur). */
  readonly label: string;
  /** Une ligne : quand cette notification arrive, du point de vue de l'utilisateur. */
  readonly description: string;
}

/**
 * Types dont le destinataire est désigné par son dossier (l'inscrit, le
 * participant) et non par une requête sur son rôle : tout le monde est
 * concerné.
 */
const ALL_ROLES: readonly UserRole[] = Object.values(UserRole);

/**
 * Catalogue complet des types de notification.
 *
 * `Record<NotificationType, …>` est délibéré : ajouter une valeur à l'enum
 * Prisma sans l'y décrire ne compile pas. Un type ne peut donc pas atterrir en
 * production sans défaut documenté ni libellé.
 */
export const NOTIFICATION_CATALOG: Readonly<
  Record<NotificationType, NotificationTypeDefinition>
> = {
  // ── Concerne directement l'utilisateur → activé par défaut (opt-out) ───────
  [NotificationType.REGISTRATION_STATUS]: {
    defaultEnabled: true,
    configurable: true,
    // Destinataire = `registration.userId`, sans filtre de rôle côté producteur.
    roles: ALL_ROLES,
    label: "Mes inscriptions",
    description:
      "Quand votre inscription à une épreuve est enregistrée, validée, refusée ou annulée par votre club.",
  },
  [NotificationType.COMPETITION_RESULTS]: {
    defaultEnabled: true,
    configurable: true,
    // Destinataire = les `registration.userId` de la compétition, tous rôles.
    roles: ALL_ROLES,
    label: "Résultats de compétition",
    description:
      "Quand les résultats d'une compétition à laquelle vous êtes inscrit sont publiés.",
  },

  // ── Ciblée : l'éligibilité est calculée AVANT l'envoi → activé par défaut ──
  //
  // Longtemps à `false` parce qu'on la prenait pour une diffusion générale.
  // Elle n'en est pas une : `notifyNewCompetition` ne retient que les licenciés
  // dont la discipline, le niveau ET la classe d'âge correspondent à au moins
  // une épreuve (`matchesEvent`). C'est donc une notification personnelle et
  // pertinente, pas du bruit — la laisser en opt-in revenait à la rendre
  // invisible à ceux qu'elle concerne.
  //
  // RÉSERVE CONNUE : le filtre est permissif, un profil dont la discipline, le
  // niveau et la classe d'âge sont tous vides correspond à TOUTES les épreuves.
  // Pour ces comptes-là, et eux seuls, l'envoi redevient général.
  [NotificationType.NEW_COMPETITION]: {
    defaultEnabled: true,
    configurable: true,
    // CompetitionEventNotificationService.notifyNewCompetition interroge
    // `where: { role: LICENSEE }` : aucun autre rôle ne peut la recevoir.
    roles: [UserRole.LICENSEE],
    label: "Nouvelles compétitions",
    description:
      "Quand une compétition correspondant à votre catégorie et à votre niveau est ouverte aux inscriptions.",
  },
  [NotificationType.CLUB_MEMBER_REGISTRATION]: {
    // Un gestionnaire de club recevrait une push par inscription de chaque
    // licencié : dans un club d'une centaine de membres, un week-end
    // d'ouverture suffirait à faire désinstaller l'application.
    defaultEnabled: false,
    configurable: true,
    // RegistrationNotificationService.notifyClubOrganizers interroge
    // `where: { role: CLUB }`.
    roles: [UserRole.CLUB],
    label: "Inscriptions des licenciés de mon club",
    description:
      "Quand un licencié de votre club s'inscrit à une épreuve ou s'en désinscrit.",
  },

  // ── Appelle une action du destinataire → activé par défaut (opt-out) ───────
  [NotificationType.CLUB_PARTNERSHIP]: {
    defaultEnabled: true,
    configurable: true,
    // PartnershipService.notifyClubOrganizersForClub interroge
    // `where: { role: "CLUB" }`.
    roles: [UserRole.CLUB],
    label: "Couples inter-club",
    description:
      "Quand un couple inter-club impliquant votre club est proposé, validé, refusé ou clôturé.",
  },
  [NotificationType.TRACK_REPORT]: {
    defaultEnabled: true,
    configurable: true,
    // TrackCorrectionsService.notifyAdmins interroge `where: { role: ADMIN }`.
    roles: [UserRole.ADMIN],
    label: "Signalements de musique",
    description:
      "Quand un utilisateur signale une musique ou propose une correction de ses informations (réservé aux administrateurs).",
  },

  // ── Concerne directement l'utilisateur → activé par défaut (opt-out) ───────
  [NotificationType.TRACK_CORRECTION_DECISION]: {
    defaultEnabled: true,
    configurable: true,
    // Destinataire = `correction.proposedById`, sans filtre de rôle : tout
    // utilisateur authentifié peut proposer une correction.
    roles: ALL_ROLES,
    label: "Mes propositions de correction",
    description:
      "Quand un administrateur valide ou refuse une correction de musique que vous avez proposée.",
  },

  // ── Déclenchée par l'utilisateur lui-même → non réglable ───────────────────
  [NotificationType.DIAGNOSTIC_TEST]: {
    defaultEnabled: true,
    configurable: false,
    // Sans objet : `configurable: false` le retire du catalogue avant tout
    // filtrage par rôle. Renseigné parce que chacun peut déclencher son propre
    // diagnostic, quel que soit son rôle.
    roles: ALL_ROLES,
    label: "Test de notification",
    description:
      "La notification de diagnostic que vous déclenchez vous-même depuis les réglages.",
  },
};

/**
 * Types proposés à l'utilisateur, dans l'ordre de déclaration de l'enum Prisma
 * — qui est donc l'ordre d'affichage de l'écran de réglages.
 *
 * Dérivé de l'enum plutôt qu'écrit à la main : un type ajouté par une migration
 * ultérieure apparaît dans l'écran sans toucher ni à ce fichier ni au client.
 */
export const CONFIGURABLE_NOTIFICATION_TYPES: readonly NotificationType[] =
  Object.values(NotificationType).filter(
    (type) => NOTIFICATION_CATALOG[type].configurable,
  );

/**
 * Comportement d'un type pour un compte sans préférence enregistrée.
 * Centralisé ici : c'est la seule définition du « défaut documenté » que les
 * critères d'acceptation de l'issue #37 opposent aux lignes explicites.
 */
export const isEnabledByDefault = (type: NotificationType): boolean =>
  NOTIFICATION_CATALOG[type].defaultEnabled;

/** Un type que l'utilisateur a le droit de régler (cf. `configurable`). */
export const isConfigurable = (type: NotificationType): boolean =>
  NOTIFICATION_CATALOG[type].configurable;

/**
 * Ce type s'adresse-t-il au rôle donné ?
 *
 * `role` arrive du JWT en `string` (cf. `RequestWithUser`), pas en `UserRole` :
 * la comparaison est volontairement faite sur la valeur. Un rôle inconnu —
 * token d'une version antérieure, rôle retiré de l'enum — ne correspond à
 * aucune entrée et ne se voit donc proposer que… rien. C'est le sens fermé :
 * mieux vaut un écran vide qu'un interrupteur sans effet ou qu'une écriture
 * qu'on ne pourra plus relire.
 */
export const isApplicableToRole = (
  type: NotificationType,
  role: string,
): boolean =>
  (NOTIFICATION_CATALOG[type].roles as readonly string[]).includes(role);

/**
 * Les interrupteurs à présenter à un rôle : les types réglables qui le
 * concernent, dans l'ordre de déclaration de l'enum.
 */
export const configurableTypesForRole = (
  role: string,
): readonly NotificationType[] =>
  CONFIGURABLE_NOTIFICATION_TYPES.filter((type) =>
    isApplicableToRole(type, role),
  );
