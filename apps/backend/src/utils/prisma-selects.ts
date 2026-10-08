/**
 * Sélecteurs Prisma réutilisables pour optimiser les requêtes
 * Utilise `select` au lieu de `include` pour limiter les champs récupérés
 */

/**
 * Sélecteur pour les informations utilisateur de base (sans mot de passe)
 */
export const userBaseSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  ageGroup: true,
  category: true,
  clubId: true,
  clubName: true,
  birthDate: true,
  nationalRanking: true,
  passportLevelLatin: true,
  passportLevelStandard: true,
} as const;

/**
 * Sélecteur pour les informations utilisateur avec licence
 */
export const userWithLicenseSelect = {
  ...userBaseSelect,
  license: {
    select: {
      id: true,
      number: true,
      validUntil: true,
      category: true,
      clubName: true,
      qrCodeSignature: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const;

/**
 * Sélecteur pour les informations utilisateur minimales (pour les listes)
 */
export const userMinimalSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  clubName: true,
  nationalRanking: true,
} as const;

/**
 * Sélecteur pour les compétitions de base
 */
export const competitionBaseSelect = {
  id: true,
  ffdId: true,
  title: true,
  date: true,
  location: true,
  address: true,
  zipCode: true,
  city: true,
  latitude: true,
  longitude: true,
  description: true,
  eventsDescription: true,
  programUrl: true,
  endDate: true,
  type: true,
  organizer: true,
  circularUrl: true,
  registrationUrl: true,
  imageUrl: true,
  status: true,
  delayMinutes: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Champs minimaux de la compétition pour la logique d'inscription
 * (évite de charger le JSON de layout). `registrationDeadline` sert au
 * contrôle serveur de la date limite (#821).
 */
export const competitionForRegistrationSelect = {
  id: true,
  date: true,
  competitionType: true,
  title: true,
  registrationDeadline: true,
} as const;

/**
 * Sélecteur pour les événements de base
 */
export const eventBaseSelect = {
  id: true,
  category: true,
  ageGroup: true,
  competitionId: true,
} as const;

/**
 * Sélecteur pour les inscriptions de base
 */
export const registrationBaseSelect = {
  id: true,
  userId: true,
  eventId: true,
  partnerName: true,
  status: true,
  bibNumber: true,
  checkedIn: true,
  checkInTime: true,
  feePaid: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Sélecteur pour les notifications de base
 */
export const notificationBaseSelect = {
  id: true,
  userId: true,
  title: true,
  body: true,
  type: true,
  read: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Sélecteur pour les licences de base
 */
export const licenseBaseSelect = {
  id: true,
  userId: true,
  number: true,
  validUntil: true,
  category: true,
  clubName: true,
  qrCodeSignature: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Sélecteur minimal pour une licence : seul l'identifiant (ex. retour d'une
 * création dont on connaît déjà les champs).
 */
export const licenseIdSelect = {
  id: true,
} as const;

/**
 * Sélecteur pour l'envoi push : seul le token est nécessaire pour appeler FCM
 * et pour nettoyer les tokens rejetés.
 */
export const deviceTokenPushSelect = {
  token: true,
} as const;

/**
 * Sélecteur pour le plafonnement du nombre d'appareils par utilisateur : on ne
 * lit que l'identifiant des lignes à conserver, jamais le token lui-même.
 */
export const deviceTokenIdSelect = {
  id: true,
} as const;

/**
 * Sélecteur pour l'export RGPD (art. 15/20) : les MÉTADONNÉES de l'appareil,
 * sans la valeur du token.
 *
 * Le token est bien une donnée personnelle (identifiant d'appareil), mais
 * l'exporter en clair créerait un vecteur de fuite : quiconque connaît un token
 * peut le ré-attribuer à son propre compte via `POST /notifications/device-token`
 * (l'upsert est volontairement ré-attributif). La personne concernée apprend
 * donc quels appareils sont enregistrés et depuis quand, pas leur adresse de
 * livraison FCM.
 */
export const deviceTokenExportSelect = {
  platform: true,
  createdAt: true,
  lastSeenAt: true,
} as const;

/**
 * Sélecteur pour la résolution d'une préférence de notification : seul l'état
 * compte, la ligne est déjà identifiée par la contrainte unique (userId, type).
 */
export const notificationPreferenceEnabledSelect = {
  enabled: true,
} as const;

/**
 * Sélecteur pour la lecture du catalogue d'un utilisateur : les choix
 * explicites qu'il a enregistrés, que l'API complète par les défauts du
 * catalogue pour les types restants.
 */
export const notificationPreferenceStateSelect = {
  type: true,
  enabled: true,
} as const;

/**
 * Sélecteur pour l'export RGPD (art. 15/20) des préférences de notification :
 * le choix de l'utilisateur et sa date, sans identifiant technique.
 */
export const notificationPreferenceExportSelect = {
  type: true,
  enabled: true,
  updatedAt: true,
} as const;

/**
 * Sélecteur pour la purge des documents de renouvellement de licence à la
 * suppression de compte (RGPD art. 17) : seule la référence du fichier
 * (nom de blob, ou chemin disque historique) est lue.
 */
export const licenseRenewalDocumentFileSelect = {
  filePath: true,
} as const;

/** Sélecteur minimal : identifiant seul (destinataires d'une notification…). */
export const idOnlySelect = {
  id: true,
} as const;

/**
 * Sélecteur pour l'affichage du nom d'un utilisateur (auteur, relecteur…) :
 * identifiant et nom, jamais l'e-mail.
 */
export const userNameSelect = {
  id: true,
  firstName: true,
  lastName: true,
} as const;

/**
 * Valeurs ACTUELLES d'une piste, affichées à côté d'une proposition de
 * correction pour que l'administrateur voie le diff avant de trancher.
 */
export const trackCorrectionTrackSnapshotSelect = {
  id: true,
  title: true,
  artist: true,
  style: true,
  bpm: true,
  // Tempo brut détecté : sert à calculer le MPM qui résultera d'une
  // validation (changement de danse seul → MPM recalculé). Non renvoyé tel quel.
  rawBpm: true,
  clashTimecodes: true,
  titleMasked: true,
  blacklisted: true,
} as const;

/**
 * Piste visée par une NOUVELLE proposition : de quoi refuser une piste
 * blacklistée et ne garder que les valeurs qui diffèrent réellement.
 */
export const trackCorrectionTargetSelect = {
  title: true,
  titleMasked: true,
  artist: true,
  style: true,
  bpm: true,
  clashTimecodes: true,
  blacklisted: true,
} as const;

/** Champs propres à une proposition de correction (sans relation). */
export const trackCorrectionBaseSelect = {
  id: true,
  trackId: true,
  reason: true,
  proposedTitle: true,
  proposedArtist: true,
  proposedStyle: true,
  proposedBpm: true,
  proposesClashes: true,
  proposedClashTimecodes: true,
  message: true,
  status: true,
  reviewComment: true,
  reviewedAt: true,
  createdAt: true,
} as const;

/**
 * File de modération (ADMIN) : la proposition, les valeurs courantes de la
 * piste et le nom de l'auteur et du relecteur.
 */
export const trackCorrectionAdminSelect = {
  ...trackCorrectionBaseSelect,
  track: { select: trackCorrectionTrackSnapshotSelect },
  proposedBy: { select: userNameSelect },
  reviewedBy: { select: userNameSelect },
} as const;

/**
 * « Mes propositions » : la proposition et de quoi nommer la piste. Les
 * drapeaux de modération servent à masquer le nom côté non-admin
 * (publicTrackName) — ne jamais renvoyer `title`/`artist` bruts.
 */
export const trackCorrectionMineSelect = {
  ...trackCorrectionBaseSelect,
  track: {
    select: {
      id: true,
      title: true,
      artist: true,
      titleMasked: true,
      blacklisted: true,
    },
  },
} as const;

/**
 * Décision d'un administrateur : l'état (garde contre la double décision),
 * les valeurs proposées à appliquer, l'auteur à notifier et le titre de la
 * piste pour le message.
 */
export const trackCorrectionDecisionSelect = {
  id: true,
  trackId: true,
  status: true,
  proposedById: true,
  proposedTitle: true,
  proposedArtist: true,
  proposedStyle: true,
  proposedBpm: true,
  proposesClashes: true,
  proposedClashTimecodes: true,
  track: {
    select: { title: true, artist: true, titleMasked: true, blacklisted: true },
  },
} as const;

/**
 * Export RGPD (art. 15/20) des propositions de correction : le contenu soumis
 * par l'utilisateur et la décision, sans l'identité de l'administrateur
 * (donnée d'un tiers). Les drapeaux de modération sont lus pour que l'export
 * masque le nom d'une piste modérée (publicTrackName) : sans eux, proposer une
 * correction puis exporter ses données démasquerait la piste.
 */
export const trackCorrectionExportSelect = {
  reason: true,
  proposedTitle: true,
  proposedArtist: true,
  proposedStyle: true,
  proposedBpm: true,
  proposesClashes: true,
  proposedClashTimecodes: true,
  message: true,
  status: true,
  reviewComment: true,
  reviewedAt: true,
  createdAt: true,
  track: {
    select: { title: true, artist: true, titleMasked: true, blacklisted: true },
  },
} as const;

/** Back-office: one audit row with its author's name. */
export const adminAuditLogSelect = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  before: true,
  after: true,
  createdAt: true,
  actor: { select: userNameSelect },
} as const;

/** Back-office: club options for selects (id + name only). */
export const adminClubOptionSelect = { id: true, name: true } as const;

/** Back-office users table. Never select password. */
export const adminUserListSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  clubId: true,
  clubName: true,
  category: true,
  ageGroup: true,
  createdAt: true,
  disabledAt: true,
  license: { select: { number: true, validUntil: true } },
} as const;

/** Back-office user page. Never select password. */
export const adminUserDetailSelect = {
  ...adminUserListSelect,
  birthDate: true,
  nationalRanking: true,
  passportLevelLatin: true,
  passportLevelStandard: true,
  competitionLevel: true,
  wdsfMin: true,
  wdsfExpiresOn: true,
  lastLoginAt: true,
  updatedAt: true,
  // Why a CLUB account may be blocked although the account itself is active.
  club: { select: { disabledAt: true } },
} as const;

/** Back-office status toggle: current state only. */
export const adminUserStatusSelect = { id: true, disabledAt: true } as const;

/** Back-office: the editable fields of a user, for the audit diff. */
export const adminUserEditableSelect = {
  id: true,
  firstName: true,
  lastName: true,
  clubId: true,
  clubName: true,
  category: true,
  ageGroup: true,
  passportLevelLatin: true,
  passportLevelStandard: true,
  competitionLevel: true,
  nationalRanking: true,
  role: true,
} as const;

/** Admin invitation resend: who to mail and whether they ever logged in. */
export const adminInvitationTargetSelect = {
  id: true,
  email: true,
  firstName: true,
  role: true,
  lastLoginAt: true,
  disabledAt: true,
  // A CLUB account of a disabled club cannot log in: no invitation either.
  club: { select: { disabledAt: true } },
} as const;

/**
 * Account status, read at login, at refresh and on every authenticated
 * request (JwtStrategy). Indexed lookup by primary key, three columns.
 */
export const accountStatusSelect = {
  role: true,
  extraRoles: true,
  disabledAt: true,
  club: { select: { disabledAt: true } },
} as const;

/** Back-office deletion: what the confirmation and the audit row need. */
export const adminUserDeletionTargetSelect = {
  id: true,
  email: true,
  role: true,
} as const;

/** Back-office clubs table. Never select HelloAsso credentials. */
export const adminClubListSelect = {
  id: true,
  name: true,
  registrationMode: true,
  disabledAt: true,
  createdAt: true,
} as const;

/** Back-office club page: one member row. */
export const adminClubMemberSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  disabledAt: true,
} as const;

/** Back-office club edit: the editable fields, for the audit diff. */
export const adminClubEditableSelect = {
  id: true,
  name: true,
  registrationMode: true,
} as const;

/** Back-office club status toggle: current state only. */
export const adminClubStatusSelect = { id: true, disabledAt: true } as const;

/** Existing club an admin attaches a new account to (refused when disabled). */
export const adminClubAttachSelect = {
  id: true,
  name: true,
  disabledAt: true,
} as const;

/** Caller of a club-representative action: roles, club, club status (lot 1c). */
export const userRolesClubSelect = {
  role: true,
  extraRoles: true,
  clubId: true,
  clubName: true,
  club: { select: { disabledAt: true } },
} as const;
