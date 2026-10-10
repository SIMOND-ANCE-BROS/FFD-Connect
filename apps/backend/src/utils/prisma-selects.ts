/**
 * Sélecteurs Prisma réutilisables pour optimiser les requêtes
 * Utilise `select` au lieu de `include` pour limiter les champs récupérés
 */

import { TrackCorrectionStatus } from "@prisma/client";

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
 * Niveaux de compétition d'un utilisateur : un par discipline + l'ancien
 * niveau unique (déprécié, lu en repli). À lire via
 * getCompetitionLevelForCategory (src/common/competition-level).
 */
export const competitionLevelsSelect = {
  competitionLevel: true,
  competitionLevelLatin: true,
  competitionLevelStandard: true,
} as const;

/** Champs du profil dont dépend l'éligibilité à une épreuve. */
export const userEligibilityProfileSelect = {
  ...competitionLevelsSelect,
  category: true,
  ageGroup: true,
} as const;

/** Membre d'une Solo Team : identité + niveaux (calcul du niveau d'équipe). */
export const soloTeamMemberUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  ...competitionLevelsSelect,
} as const;

/** Création d'un couple : appartenance au club + données de suggestion (âge, disciplines, niveaux). */
export const partnershipCandidateSelect = {
  clubId: true,
  clubName: true,
  birthDate: true,
  ...userEligibilityProfileSelect,
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
 * Champs d'une licence nécessaires au pass Apple Wallet (#162) : contenu du
 * pass + nom du titulaire. Rien d'autre (minimisation).
 */
export const licenseWalletPassSelect = {
  id: true,
  number: true,
  validUntil: true,
  category: true,
  user: { select: { firstName: true, lastName: true } },
} as const;

/**
 * Jeton de téléchargement de pass Wallet (#162) : à qui il appartient,
 * jusqu'à quand il vaut et combien de téléchargements il a déjà servis.
 */
export const walletPassTokenSelect = {
  userId: true,
  expiresAt: true,
  downloadCount: true,
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

/**
 * Document de renouvellement tel que l'API le renvoie (#224). `ocrData` est lu
 * pour le résumé affiché dans l'app, mais ne sort JAMAIS tel quel : il passe
 * par `toRenewalDocumentResponse`, qui ne garde que les champs utiles (jamais
 * `rawText`, texte brut du certificat médical). `purgeDueAt` reste interne.
 */
export const licenseRenewalDocumentResponseSelect = {
  id: true,
  requestId: true,
  type: true,
  filePath: true,
  ocrData: true,
  createdAt: true,
} as const;

/**
 * Demande de renouvellement telle que l'API la renvoie, documents compris.
 * Les documents ne sont pas bornés par `take` : un remplacement supprime
 * l'ancien document du même type, il y en a donc au plus un par type (2).
 */
export const licenseRenewalRequestResponseSelect = {
  id: true,
  userId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  documents: { select: licenseRenewalDocumentResponseSelect },
} as const;

/**
 * Export RGPD (art. 15/20) d'un document de renouvellement : type, date de
 * dépôt et données lues. `ocrData` est lu pour être filtré par
 * `pickRenewalOcrData` (liste blanche, jamais `rawText`) avant de sortir. La
 * référence de stockage (`filePath`) et l'échéance de purge restent internes.
 */
export const licenseRenewalDocumentExportSelect = {
  type: true,
  ocrData: true,
  createdAt: true,
} as const;

/**
 * Export RGPD (art. 15/20) des demandes de renouvellement de licence. Comme
 * pour la réponse API, les documents ne sont pas bornés : au plus un par type.
 */
export const licenseRenewalRequestExportSelect = {
  status: true,
  createdAt: true,
  updatedAt: true,
  documents: {
    select: licenseRenewalDocumentExportSelect,
    orderBy: { createdAt: "asc" },
  },
} as const;

/** Export RGPD : appartenance aux équipes solo du club (nom, niveau, date). */
export const soloTeamMembershipExportSelect = {
  createdAt: true,
  team: { select: { name: true, level: true } },
} as const;

/**
 * Export RGPD : réservations de places. La référence de paiement externe
 * (HelloAsso) et l'identifiant de l'emplacement dans le plan restent internes.
 */
export const seatBookingExportSelect = {
  seatLabel: true,
  status: true,
  createdAt: true,
  competition: { select: { title: true, date: true } },
} as const;

/** Dépôt d'un document : statut de la demande + fichiers déjà déposés. */
export const licenseRenewalUploadTargetSelect = {
  status: true,
  documents: { select: { type: true, filePath: true } },
} as const;

/** Soumission : statut + données OCR des documents, pour les règles métier. */
export const licenseRenewalSubmitTargetSelect = {
  status: true,
  documents: { select: { type: true, ocrData: true } },
} as const;

/** Approbation : de quoi renouveler la licence, sans le reste du profil. */
export const licenseRenewalApprovalTargetSelect = {
  status: true,
  userId: true,
  documents: { select: { type: true, ocrData: true } },
  user: {
    select: {
      category: true,
      clubName: true,
      license: { select: { number: true, validUntil: true } },
    },
  },
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
  // Audio file, for the back-office player (`/uploads/<filename>`).
  filename: true,
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
 * Track fields an approved correction may change, read just before and just
 * after the update inside the decision transaction: the audit row then holds
 * what was really applied (MPM recalculated on a dance change, sorted clashes).
 */
export const trackCorrectionAuditTrackSelect = {
  title: true,
  artist: true,
  style: true,
  bpm: true,
  clashTimecodes: true,
} as const;

/**
 * Track fields of a TRACK_UPDATE audit row: read by the write guard and
 * returned by the update itself, inside the same transaction.
 */
export const trackAuditSelect = {
  title: true,
  artist: true,
  style: true,
  bpm: true,
  titleMasked: true,
  blacklisted: true,
  clashTimecodes: true,
  status: true,
} as const;

/** Guard read of TracksService.updateTrack: owner, raw tempo, audited fields. */
export const trackUpdateTargetSelect = {
  submittedById: true,
  rawBpm: true,
  ...trackAuditSelect,
} as const;

/** What a track deletion audits (metadata only) and which files it removes. */
export const trackDeletionSelect = {
  title: true,
  artist: true,
  sourceKey: true,
  filename: true,
  artwork: true,
} as const;

/** Back-office catalogue: every field of AdminTrackDto, plus the pending corrections. */
export const adminTrackSelect = {
  id: true,
  title: true,
  artist: true,
  style: true,
  bpm: true,
  rawBpm: true,
  clashTimecodes: true,
  titleMasked: true,
  blacklisted: true,
  status: true,
  sourceKey: true,
  filename: true,
  artwork: true,
  createdAt: true,
  _count: {
    select: {
      corrections: { where: { status: TrackCorrectionStatus.PENDING } },
    },
  },
} as const;

/** Duplicate lookup of the import: a hit by content hash or by source key. */
export const trackDuplicateSelect = {
  id: true,
  sourceKey: true,
  contentHash: true,
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
  extraRoles: true,
  clubId: true,
  clubName: true,
  category: true,
  ageGroup: true,
  createdAt: true,
  disabledAt: true,
  isStoreReview: true,
  license: { select: { number: true, validUntil: true } },
} as const;

/** Back-office user page. Never select password. */
export const adminUserDetailSelect = {
  ...adminUserListSelect,
  birthDate: true,
  nationalRanking: true,
  passportLevelLatin: true,
  passportLevelStandard: true,
  ...competitionLevelsSelect,
  wdsfMin: true,
  wdsfExpiresOn: true,
  lastLoginAt: true,
  updatedAt: true,
  // Why a CLUB account may be blocked although the account itself is active.
  club: { select: { disabledAt: true } },
} as const;

/** Back-office status toggle: current state + store-review protection. */
export const adminUserStatusSelect = {
  id: true,
  disabledAt: true,
  isStoreReview: true,
} as const;

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
  ...competitionLevelsSelect,
  nationalRanking: true,
  role: true,
  extraRoles: true,
} as const;

/** Admin invitation resend: who to mail and whether they ever logged in. */
export const adminInvitationTargetSelect = {
  id: true,
  email: true,
  firstName: true,
  role: true,
  // An extra ADMIN role blocks the invitation too (hasRole).
  extraRoles: true,
  lastLoginAt: true,
  disabledAt: true,
  // A CLUB account of a disabled club cannot log in: no invitation either.
  club: { select: { disabledAt: true } },
} as const;

/**
 * Account status, read at login, at refresh and on every authenticated
 * request (JwtStrategy). Indexed lookup by primary key, four columns.
 * `isStoreReview` rides along so the store-review simulated-write mode costs
 * no extra query (StoreReviewInterceptor).
 */
export const accountStatusSelect = {
  role: true,
  extraRoles: true,
  disabledAt: true,
  isStoreReview: true,
  club: { select: { disabledAt: true } },
} as const;

/** Back-office deletion: what the confirmation and the audit row need. */
export const adminUserDeletionTargetSelect = {
  id: true,
  email: true,
  role: true,
  isStoreReview: true,
} as const;

/** Back-office clubs table. Never select HelloAsso credentials. */
export const adminClubListSelect = {
  id: true,
  name: true,
  registrationMode: true,
  disabledAt: true,
  isStoreReview: true,
  createdAt: true,
} as const;

/** Back-office club page: one member row. */
export const adminClubMemberSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  extraRoles: true,
  disabledAt: true,
} as const;

/** Back-office club edit: the editable fields, for the audit diff. */
export const adminClubEditableSelect = {
  id: true,
  name: true,
  registrationMode: true,
} as const;

/** Back-office club status toggle: current state + store-review protection. */
export const adminClubStatusSelect = {
  id: true,
  disabledAt: true,
  isStoreReview: true,
} as const;

/** Back-office club deletion: name for the audit row + store-review protection. */
export const adminClubDeletionTargetSelect = {
  id: true,
  name: true,
  isStoreReview: true,
} as const;

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

/** Check-in operator: roles plus every club name it can be matched on. */
export const userRolesClubNameSelect = {
  ...userRolesClubSelect,
  club: { select: { disabledAt: true, name: true } },
} as const;

/** Competition ownership check: the organizing club's name. */
export const competitionOrganizerSelect = { organizer: true } as const;

/**
 * Volunteer check-in link as returned to the organizer: never the stored
 * token column (a SHA-256 hash); the plain token is added once by the caller.
 */
export const volunteerTokenIssuedSelect = {
  id: true,
  competitionId: true,
  expiresAt: true,
  name: true,
  createdAt: true,
} as const;

/** Volunteer check-in link validation: scope and expiry, never the hash. */
export const volunteerTokenAuthSelect = {
  id: true,
  competitionId: true,
  expiresAt: true,
  name: true,
} as const;

/**
 * TEMPORARY — what the FFD épreuves deduction needs to decide whether a
 * synced competition's events may be replaced: its documents, the stored
 * fingerprint, and each event's shape + dependants (registrations, results,
 * schedule). The event list is bounded (`take`), a deduced set never exceeds
 * MAX_DEDUCED_EVENTS (400).
 */
export const competitionEventsDeductionSelect = {
  id: true,
  eventsDescription: true,
  circularUrl: true,
  eventsSource: true,
  eventsFingerprint: true,
  events: {
    select: {
      category: true,
      ageGroup: true,
      eventType: true,
      level: true,
      eventKind: true,
      _count: {
        select: { registrations: true, results: true, scheduleItems: true },
      },
    },
    take: 500,
  },
} as const;
