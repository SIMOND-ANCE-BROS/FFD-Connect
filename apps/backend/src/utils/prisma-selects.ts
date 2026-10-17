/**
 * Sélecteurs Prisma réutilisables pour optimiser les requêtes
 * Utilise `select` au lieu de `include` pour limiter les champs récupérés
 */

import { TrackCorrectionStatus } from "@prisma/client";

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
  // Espoir (16–20 on 31 December) is decided on the actual age.
  birthDate: true,
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
  ...userEligibilityProfileSelect,
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
 * Inscriptions en attente vues par le club (#753), GET
 * /competitions/club/pending-registrations : le contrat
 * `ClubPendingRegistration` du client, plus `createdAt` (date affichée).
 */
export const clubPendingRegistrationSelect = {
  id: true,
  eventId: true,
  userId: true,
  partnerName: true,
  status: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      clubName: true,
    },
  },
  event: {
    select: {
      id: true,
      category: true,
      ageGroup: true,
      eventType: true,
      competitionId: true,
    },
  },
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
 * Champs du profil dont on déduit la ou les disciplines pratiquées par un
 * licencié (`practisedDiscipline`, #552) : discipline déclarée + niveaux par
 * discipline.
 */
export const userDisciplineSelect = {
  category: true,
  competitionLevelLatin: true,
  competitionLevelStandard: true,
} as const;

/** Licence + profil de discipline de son titulaire (carte de licence, #552). */
export const licenseWithHolderDisciplineSelect = {
  ...licenseBaseSelect,
  user: { select: userDisciplineSelect },
} as const;

/**
 * Champs d'une licence nécessaires au pass Apple Wallet (#162) : contenu du
 * pass + nom et discipline(s) pratiquée(s) du titulaire (#552). Rien d'autre
 * (minimisation).
 */
export const licenseWalletPassSelect = {
  id: true,
  number: true,
  validUntil: true,
  category: true,
  user: {
    select: { firstName: true, lastName: true, ...userDisciplineSelect },
  },
} as const;

/**
 * Jours d'une compétition (début, fin éventuelle) : borne l'heure de scan
 * déclarée par un check-in hors ligne rejoué (#24).
 */
export const competitionDaysSelect = {
  date: true,
  endDate: true,
} as const;

/**
 * What a check-in needs to know about the competition: its days (bounds of
 * an offline replay's claimed scan time, #24) and whether the rotating entry
 * QR is mandatory (#668).
 */
export const competitionCheckInPolicySelect = {
  ...competitionDaysSelect,
  requireRotatingQr: true,
} as const;

/**
 * Champs d'une licence nécessaires au lot de QR d'entrée tournants (#24) :
 * ce que le QR porte (id, numéro, nom du titulaire) et jusqu'à quand il peut
 * être émis. Rien d'autre (minimisation).
 */
export const licenseEntryQrSelect = {
  id: true,
  number: true,
  validUntil: true,
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
 * Licence et compte rattaché : réparation des licences bêta « placeholder »
 * (#555), qui remet aussi à null la discipline recopiée dans le profil.
 */
export const licenseIdHolderSelect = {
  id: true,
  userId: true,
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
 * suppression de compte (RGPD art. 17) : la référence du fichier (nom de
 * blob, ou chemin disque historique), plus l'id et le type pour tracer la
 * suppression des certificats médicaux (#63). Jamais `ocrData`.
 */
export const licenseRenewalDocumentFileSelect = {
  id: true,
  type: true,
  filePath: true,
} as const;

/**
 * Suppression de compte (RGPD art. 17, #382) : résultats de compétition à
 * anonymiser. `details` est lu pour n'en garder que les clés non
 * identifiantes ; la compétition sert à invalider le cache des résultats.
 */
export const resultAnonymizationSelect = {
  id: true,
  details: true,
  event: { select: { competitionId: true } },
} as const;

/**
 * Suppression de compte (#395) : résultat de couple rattaché au PARTENAIRE
 * dont le libellé nomme la personne supprimée. `userId` (celui du
 * partenaire) garde la réécriture : une ligne réattribuée ou supprimée entre
 * la lecture et la transaction n'est pas touchée et ne fait pas échouer la
 * suppression.
 */
export const partnerCoupleResultSelect = {
  ...resultAnonymizationSelect,
  userId: true,
} as const;

/**
 * Ligne de résultat publiée par `GET /competitions/:id/results` (endpoint
 * public, sans authentification). Minimisation (RGPD art. 5.1.c, #413) :
 * jamais `userId` (identifiant interne du compte du couple), ni `createdAt`.
 * Seuls les champs que l'écran des résultats affiche.
 */
export const publicResultSelect = {
  id: true,
  eventId: true,
  round: true,
  ranking: true,
  details: true,
} as const;

/**
 * Import de résultats (#652) : ligne déjà importée, relue pour être mise à
 * jour. `userId` dit si elle a été anonymisée (suppression de compte) ;
 * `details` si un libellé a été expurgé (« Partenaire supprimé »).
 */
export const resultImportExistingSelect = {
  id: true,
  eventId: true,
  round: true,
  importKey: true,
  userId: true,
  partnerUserId: true,
  ranking: true,
  details: true,
} as const;

/**
 * Import de résultats (#652) : ligne anonymisée d'une épreuve, comparée par
 * tour normalisé + rang pour ne jamais recréer un couple effacé avec son nom.
 */
export const resultTombstoneSelect = {
  eventId: true,
  round: true,
  ranking: true,
} as const;

/**
 * Import de résultats (#690) : épreuve d'une compétition avec ce qui forme
 * son nom (« Latines Adultes Avancé »), pour relier une ligne par le nom de
 * l'épreuve au lieu de son identifiant.
 */
export const eventResultImportLabelSelect = {
  id: true,
  category: true,
  ageGroup: true,
  level: true,
} as const;

/**
 * Suppression des résultats importés d'une épreuve (#690) : `userId` et
 * `details` disent si la ligne porte un effacement RGPD (gardée).
 */
export const resultUndoSelect = {
  id: true,
  userId: true,
  details: true,
} as const;

/** Numéro de licence seul (licences retirées, licences d'un compte supprimé). */
export const licenseNumberSelect = {
  number: true,
} as const;

/** Empreinte seule d'une licence de compte supprimé (#652). */
export const erasedResultIdentitySelect = {
  fingerprint: true,
} as const;

/**
 * Suppression de compte (#652) : licence du compte, avec les numéros qu'elle
 * a portés avant un changement, pour en garder l'empreinte.
 */
export const licenseNumbersOfUserSelect = {
  id: true,
  number: true,
} as const;

/** Import de résultats (#652) : licence → compte, pour rattacher un couple. */
export const licenseNumberUserSelect = {
  number: true,
  userId: true,
} as const;

/** Import de résultats (#652) : inscription retrouvée par épreuve + dossard. */
/**
 * Import de résultats par un club (#690) : comptes inscrits (titulaire ou
 * partenaire) à la compétition, seuls rattachables par numéro de licence.
 */
export const registrationMembersSelect = {
  userId: true,
  partnerUserId: true,
} as const;

export const registrationBibUserSelect = {
  eventId: true,
  bibNumber: true,
  userId: true,
  partnerUserId: true,
} as const;

/** « Résultats disponibles » (#652) : titre et réservation de l'envoi. */
export const competitionResultsNotificationSelect = {
  id: true,
  title: true,
  resultsNotifiedAt: true,
} as const;

/** Titulaire d'un résultat (destinataires de « Résultats disponibles », #652). */
export const resultOwnerSelect = {
  userId: true,
  partnerUserId: true,
} as const;

/** Épreuves d'une compétition avec leurs résultats publics, classés. */
export const competitionPublicResultsSelect = {
  id: true,
  events: {
    select: {
      id: true,
      category: true,
      ageGroup: true,
      results: {
        select: publicResultSelect,
        orderBy: { ranking: "asc" },
      },
    },
  },
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
  // Decision shown to the licensee (#268); who decided stays internal.
  submittedAt: true,
  rejectionReason: true,
  reviewComment: true,
  documents: { select: licenseRenewalDocumentResponseSelect },
} as const;

/**
 * Export RGPD (art. 15/20) d'un document de renouvellement : type, date de
 * dépôt et données lues. `ocrData` est lu pour être filtré par
 * `pickRenewalOcrData` (liste blanche, jamais `rawText`) avant de sortir. La
 * référence de stockage (`filePath`) et l'échéance de purge restent internes.
 */
export const licenseRenewalDocumentExportSelect = {
  // Not exported: names the document in the health-data access journal (#63).
  id: true,
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
  // Modération humaine (#266) : dates et motif de la décision, commentaire de
  // l'administrateur. Jamais son identité (comme pour les corrections).
  submittedAt: true,
  reviewedAt: true,
  rejectionReason: true,
  reviewComment: true,
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
  cancelReason: true, // why a seat was released (refund / dispute, #403)
  createdAt: true,
  competition: { select: { title: true, date: true } },
} as const;

/**
 * HelloAsso payment notification (#39): what the organizer club is told about
 * a confirmed booking, and how to find that club (`organizerClubId`, label
 * fallback, #408). Never the payer's identity nor the external payment
 * reference.
 */
export const seatBookingPaymentNotificationSelect = {
  id: true,
  seatLabel: true,
  competition: {
    select: { id: true, title: true, organizer: true, organizerClubId: true },
  },
} as const;

/** A club's identity and status, to address its managers. */
export const clubRecipientSelect = {
  id: true,
  name: true,
  disabledAt: true,
} as const;

/**
 * Checkout HelloAsso (#381) : le plan de salle porte le tarif de chaque
 * élément (`priceCents`). Le montant est lu ici, jamais dans la requête.
 */
export const competitionSeatPricingSelect = {
  id: true,
  layout: true,
} as const;

/**
 * Webhook HelloAsso (#381) : champs d'une réservation nécessaires pour
 * vérifier qu'une commande payée lui correspond bien.
 */
export const seatBookingPaymentCheckSelect = {
  id: true,
  competitionId: true,
  status: true,
  paymentId: true,
  expectedAmountCents: true,
  expiresAt: true,
  // Earlier checkout intents of a resumed payment, still payable (#428)
  supersededPaymentIds: true,
  refundOwedPaymentIds: true,
} as const;

/**
 * Checkout (#428) : réservation en attente d'un utilisateur, reprise par un
 * nouveau checkout sur la même place. `checkoutRedirectUrl` n'est rendu qu'à
 * son propriétaire.
 */
export const seatBookingHoldSelect = {
  id: true,
  seatIndex: true,
  expiresAt: true,
  createdAt: true,
  expectedAmountCents: true,
  paymentId: true,
  checkoutRedirectUrl: true,
  checkoutCreatedAt: true,
  supersededPaymentIds: true,
} as const;

/** Checkout (#428) : place occupée par une réservation active. */
export const seatBookingSeatIndexSelect = { seatIndex: true } as const;

/** Checkout (#455) : place et échéance d'une réservation laissée expirer (délai avant de la reprendre). */
export const seatBookingLapseSelect = {
  seatIndex: true,
  expiresAt: true,
} as const;

/** Checkout (#428) : créneau de réservation en attente (plafond de 4). */
export const seatBookingPendingSlotSelect = { pendingSlot: true } as const;

/**
 * Alerte « remboursement à faire » (#428) : de quoi retrouver le paiement
 * dans HelloAsso, sans donnée personnelle du payeur.
 */
export const seatBookingRefundAlertSelect = {
  id: true,
  seatIndex: true, // never the free-text seatLabel, typed by the buyer
  expectedAmountCents: true,
  competition: {
    select: { id: true, title: true, organizer: true, organizerClubId: true },
  },
} as const;

/**
 * Occupation du plan de salle (#454) : état d'une place réservée. `userId`
 * sert seulement à signaler les places de l'appelant ; il n'est jamais rendu.
 */
export const seatBookingOccupancySelect = {
  itemId: true,
  seatIndex: true,
  status: true,
  userId: true,
} as const;

/**
 * Export RGPD (#251) : contexte d'une épreuve (spécialité, classe d'âge,
 * niveau, type, compétition). Aucune donnée de personne.
 */
export const exportEventContextSelect = {
  category: true,
  ageGroup: true,
  level: true,
  eventType: true,
  competition: { select: { title: true, date: true } },
} as const;

/**
 * Export RGPD (#251) : résultats de compétition. `details` est lu pour n'en
 * extraire que `totalParticipants` (cf. UsersService.exportMyData) : son
 * libellé `participant` nomme le couple, donc aussi le partenaire (tiers).
 */
export const resultExportSelect = {
  round: true,
  ranking: true,
  details: true,
  createdAt: true,
  event: { select: exportEventContextSelect },
} as const;

/**
 * Export RGPD (#251) : inscriptions où l'utilisateur est le PARTENAIRE.
 * Contexte de l'épreuve uniquement : ni l'identité du licencié qui a inscrit
 * le couple (userId, user), ni le règlement de son inscription (feePaid).
 */
export const partnerRegistrationExportSelect = {
  status: true,
  bibNumber: true,
  coupleAgeGroup: true,
  createdAt: true,
  event: { select: exportEventContextSelect },
} as const;

/**
 * Export RGPD (#251) : musiques proposées par l'utilisateur. Le drapeau
 * `blacklisted` est lu pour masquer le nom d'une piste retirée
 * (publicTrackName), comme pour les propositions de correction.
 */
export const submittedTrackExportSelect = {
  title: true,
  artist: true,
  blacklisted: true,
  status: true,
  createdAt: true,
} as const;

/**
 * Export RGPD (#251) : signalements envoyés depuis l'app (message, appareil,
 * date). La pile d'erreur, purement technique, reste interne.
 */
export const bugReportExportSelect = {
  message: true,
  deviceInfo: true,
  createdAt: true,
} as const;

/**
 * Export RGPD (#251) : sessions « se connecter en tant que » ciblant
 * l'utilisateur. Date, motif et RÔLE de l'auteur seulement : ni son
 * identifiant (actorId) ni son adresse IP, données d'un tiers.
 */
export const impersonationLogExportSelect = {
  actorRole: true,
  reason: true,
  startedAt: true,
  endedAt: true,
  // Writes made during the session (#761), in order. Bounded above the real
  // maximum (15 minutes × 100 requests/min under the global throttler).
  actions: {
    select: {
      method: true,
      route: true,
      statusCode: true,
      at: true,
    },
    orderBy: { at: "asc" },
    take: 2000,
  },
  // Total count, so a truncated list shows in the export.
  _count: { select: { actions: true } },
} as const;

/**
 * Accès support (#733) : ce que `JwtStrategy` relit de la ligne du journal
 * désignée par le jeton d'impersonation, à chaque requête de la session.
 */
export const impersonationLogSessionSelect = {
  actorId: true,
  targetUserId: true,
  startedAt: true,
  endedAt: true,
} as const;

/**
 * Rétention du journal des accès support (#731) : ce que la troncature de
 * l'adresse IP de l'intervenant relit, rien d'autre.
 */
export const impersonationLogIpSelect = {
  id: true,
  ip: true,
} as const;

/**
 * Export RGPD (#251) : sessions de connexion (refresh tokens) en
 * MÉTADONNÉES. Jamais le hash du token (`token`), secret d'authentification.
 */
export const refreshTokenExportSelect = {
  createdAt: true,
  expiresAt: true,
  revoked: true,
  revokedAt: true,
} as const;

/**
 * Dépôt d'un document : statut de la demande + fichiers déjà déposés (l'id
 * trace la suppression d'un certificat médical remplacé, #63).
 */
export const licenseRenewalUploadTargetSelect = {
  status: true,
  documents: { select: { id: true, type: true, filePath: true } },
} as const;

/**
 * Soumission : statut + types des documents déposés. Les données OCR n'y sont
 * pas lues : elles ne sont que des indices pour l'administrateur (#271).
 */
export const licenseRenewalSubmitTargetSelect = {
  status: true,
  documents: { select: { type: true } },
} as const;

/** Fin de validité de la licence d'un utilisateur (renouvellement inutile, #250). */
export const userLicenseValidUntilSelect = {
  license: { select: { validUntil: true } },
} as const;

/** Club identity only (id + name). */
export const clubIdNameSelect = { id: true, name: true } as const;

/** Approbation : de quoi renouveler la licence, sans le reste du profil. */
export const licenseRenewalApprovalTargetSelect = {
  status: true,
  userId: true,
  documents: { select: { type: true, ocrData: true } },
  user: {
    select: {
      // Category and club of a licence created by the approval come from the
      // holder's real profile, never invented (#282).
      ...userDisciplineSelect,
      clubName: true,
      club: { select: clubIdNameSelect },
      // `id`: the number a renewal replaces is retired against it (#466).
      license: { select: { id: true, number: true, validUntil: true } },
    },
  },
} as const;

/**
 * Purge de rétention (#62) : documents échus. `requestId` sert à effacer, avec
 * le document, le commentaire de l'administrateur sur la demande (#266).
 */
export const healthDataPurgeDueSelect = {
  id: true,
  filePath: true,
  requestId: true,
  // Whose certificate is purged, for the health-data access journal (#63).
  request: { select: { userId: true } },
} as const;

/** Sélecteur minimal : identifiant seul (destinataires d'une notification…). */
export const idOnlySelect = {
  id: true,
} as const;

/**
 * Compte visé par « mot de passe oublié » (#465) : l'adresse enregistrée (seule
 * destinataire du lien) et le drapeau du compte de review, jamais réinitialisé.
 */
export const passwordResetTargetSelect = {
  id: true,
  email: true,
  isStoreReview: true,
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
 * Remboursements dus d'un club organisateur (#516) : de quoi retrouver les
 * paiements dans HelloAsso (intentions de paiement) et savoir qui rembourser.
 * Nom du danseur seulement (ni e-mail ni téléphone), jamais le `seatLabel`
 * libre saisi par l'acheteur.
 */
export const seatBookingRefundDueSelect = {
  id: true,
  seatIndex: true,
  expectedAmountCents: true,
  refundOwedPaymentIds: true,
  refundOwedAt: true,
  competition: { select: { id: true, title: true, date: true } },
  user: { select: userNameSelect },
} as const;

/**
 * Remboursements dus vus par l'administrateur (#627), tous clubs confondus :
 * les mêmes champs que pour le club, plus le club organisateur (relié, ou son
 * libellé de repli) de la compétition.
 */
export const adminSeatBookingRefundDueSelect = {
  ...seatBookingRefundDueSelect,
  competition: {
    select: {
      id: true,
      title: true,
      date: true,
      organizer: true,
      organizerClub: { select: { id: true, name: true } },
    },
  },
} as const;

/**
 * Compétitions candidates d'un club organisateur (#516) : id, club relié et
 * libellé de repli (#408, cf. organizerMatcher).
 */
export const competitionIdOrganizerSelect = {
  id: true,
  organizer: true,
  organizerClubId: true,
} as const;

/**
 * Licence résolue au check-in par QR : son id (comparé à celui que porte un QR
 * signé v2, #466) et le nom de son titulaire.
 */
export const checkInLicenseSelect = {
  id: true,
  user: { select: userNameSelect },
} as const;

/** Existence d'un numéro de licence retiré (clé primaire seule, #466). */
export const retiredLicenseNumberSelect = {
  number: true,
} as const;

/** Licence telle que la file de modération l'affiche : numéro et validité. */
export const licenseNumberValiditySelect = {
  number: true,
  validUntil: true,
} as const;

/**
 * File de modération des renouvellements (#266) : une ligne par demande. Les
 * documents ne sont décrits que par leur type et leur date — ni fichier, ni
 * référence de stockage, ni données lues. Au plus un document par type (2),
 * d'où l'absence de `take`.
 */
export const licenseRenewalAdminListSelect = {
  id: true,
  status: true,
  createdAt: true,
  submittedAt: true,
  reviewedAt: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      license: { select: licenseNumberValiditySelect },
    },
  },
  reviewedBy: { select: userNameSelect },
  documents: {
    select: { id: true, type: true, createdAt: true },
    orderBy: { type: "asc" },
  },
} as const;

/**
 * Détail d'une demande pour la modération : la ligne de la file, plus le
 * commentaire et les données lues par l'OCR (indices, filtrés par
 * `pickRenewalOcrData` et montrés seulement tant que la demande est PENDING).
 */
export const licenseRenewalAdminDetailSelect = {
  ...licenseRenewalAdminListSelect,
  userId: true,
  // Pas dans la file (non tracée) : MEDICAL_RESTRICTION est une donnée de
  // santé. Le détail, lui, est tracé (LICENSE_RENEWAL_VIEW).
  rejectionReason: true,
  reviewComment: true,
  documents: {
    select: { id: true, type: true, createdAt: true, ocrData: true },
    orderBy: { type: "asc" },
  },
} as const;

/** Historique des demandes d'un utilisateur : statuts et dates uniquement. */
export const licenseRenewalHistorySelect = {
  id: true,
  status: true,
  createdAt: true,
  submittedAt: true,
  reviewedAt: true,
} as const;

/**
 * Fichier d'un document à servir à l'administrateur, l'état de sa demande et
 * son titulaire (journal des accès aux données de santé, #63).
 */
export const licenseRenewalDocumentFileTargetSelect = {
  type: true,
  filePath: true,
  request: { select: { status: true, userId: true } },
} as const;

/**
 * Moderation decision: does the request exist, in which state, and whose is
 * it (the owner is notified of the decision, #269).
 */
export const licenseRenewalStatusOwnerSelect = {
  status: true,
  userId: true,
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
 * « Mes propositions » : la proposition et de quoi nommer la piste. Le
 * drapeau `blacklisted` sert à masquer le nom d'une piste retirée côté
 * non-admin (publicTrackName) — ne jamais renvoyer `title`/`artist` bruts.
 */
export const trackCorrectionMineSelect = {
  ...trackCorrectionBaseSelect,
  track: {
    select: {
      id: true,
      title: true,
      artist: true,
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
  // DELETE (#446) is approved by hiding the track, not by a patch.
  reason: true,
  status: true,
  proposedById: true,
  proposedTitle: true,
  proposedArtist: true,
  proposedStyle: true,
  proposedBpm: true,
  proposesClashes: true,
  proposedClashTimecodes: true,
  track: {
    select: { title: true, artist: true, blacklisted: true },
  },
} as const;

/**
 * Track fields an approved correction may change, read just before and just
 * after the update inside the decision transaction: the audit row then holds
 * what was really applied (MPM recalculated on a dance change, sorted clashes).
 * `blacklisted` is what an approved deletion request (#446) changes; only the
 * fields that differ are logged, so it stays out of the other approvals.
 */
export const trackCorrectionAuditTrackSelect = {
  title: true,
  artist: true,
  style: true,
  bpm: true,
  clashTimecodes: true,
  blacklisted: true,
} as const;

/**
 * The other pending proposals of a track removed from the library by an
 * approved deletion request (#446): rejected in the same transaction, then
 * their authors are told.
 */
export const trackCorrectionSupersededSelect = {
  id: true,
  proposedById: true,
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
 * (donnée d'un tiers). Le drapeau `blacklisted` est lu pour que l'export
 * masque le nom d'une piste retirée (publicTrackName) : sans lui, proposer une
 * correction puis exporter ses données révélerait la piste.
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
    select: { title: true, artist: true, blacklisted: true },
  },
} as const;

/** Audit rows looked up only to know which targets they concern. */
export const auditTargetIdSelect = { targetId: true } as const;

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

/**
 * Journal des accès aux données de santé (#63) : identifiants seulement, aucun
 * nom joint.
 */
export const healthDataAccessLogSelect = {
  id: true,
  subjectUserId: true,
  actorUserId: true,
  actorRole: true,
  action: true,
  resourceType: true,
  resourceId: true,
  route: true,
  createdAt: true,
} as const;

/**
 * Export RGPD (#732) : accès aux données de santé de l'utilisateur (lignes dont
 * il est la personne concernée). Qualité de l'auteur, nature, ressource, point
 * d'entrée et date — jamais l'identifiant de l'auteur (`actorUserId`, donnée
 * d'un tiers, même règle que les accès support) ni les UUID internes (`id`,
 * `resourceId`), sans valeur pour la personne.
 */
export const healthDataAccessLogExportSelect = {
  actorRole: true,
  action: true,
  resourceType: true,
  route: true,
  createdAt: true,
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
  lastLoginAt: true,
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

/**
 * Back-office change of the login email / licence number (#448): current
 * values for the audit diff, the name for the notice to the old address, the
 * store-review flag (its email is the one Apple / Google log in with).
 */
export const adminUserIdentifiersSelect = {
  id: true,
  email: true,
  firstName: true,
  isStoreReview: true,
  license: { select: { id: true, number: true } },
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
  paymentProvider: true,
  disabledAt: true,
  isStoreReview: true,
  createdAt: true,
} as const;

/**
 * Club HelloAsso credentials, read ONLY by the payment flow
 * (`getHelloAssoCredentialsForCompetition`). The secret is encrypted at rest
 * (#389) and must never be returned by an API nor logged.
 */
export const clubHelloAssoCredentialsSelect = {
  id: true,
  helloAssoClientId: true,
  helloAssoClientSecret: true,
  helloAssoOrgSlug: true,
} as const;

/** Payment connector chosen by a club (#388); NULL = HelloAsso. */
export const clubPaymentProviderSelect = {
  paymentProvider: true,
} as const;

/**
 * Club payment connector status (#388): the chosen connector and whether
 * its credentials are set. The HelloAsso secret is read only to know whether
 * it is set — never returned.
 */
export const clubPaymentProviderStatusSelect = {
  id: true,
  name: true,
  paymentProvider: true,
  helloAssoClientId: true,
  helloAssoClientSecret: true,
  helloAssoOrgSlug: true,
} as const;

/**
 * Club HelloAsso status: what the organizer sees (connected + slug, mode).
 * The secret is read only to know whether it is set — never returned.
 */
export const clubHelloAssoStatusSelect = {
  name: true,
  registrationMode: true,
  helloAssoClientId: true,
  helloAssoClientSecret: true,
  helloAssoOrgSlug: true,
} as const;

/** A club's registration mode (registration policy of its members). */
export const clubRegistrationModeSelect = {
  registrationMode: true,
} as const;

/** A club's name and registration mode (club settings). */
export const clubNameRegistrationModeSelect = {
  name: true,
  registrationMode: true,
} as const;

/** A user's club reference: linked id, or the legacy free-text name. */
export const userClubRefSelect = {
  clubId: true,
  clubName: true,
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
  paymentProvider: true,
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

/**
 * Competition ownership check / organising-club resolution (#408): the club
 * link, and the label used as fallback while the row is unlinked.
 */
export const competitionOrganizerSelect = {
  organizer: true,
  organizerClubId: true,
} as const;

/**
 * Organising-club backfill (#408): the unlinked competition and its label —
 * ids and club names only, no personal data.
 */
export const competitionOrganizerBackfillSelect = {
  id: true,
  ...competitionOrganizerSelect,
} as const;

/** FFD sync (#408): the club a competition is currently linked to. */
export const competitionLinkedOrganizerClubSelect = {
  organizerClub: { select: clubIdNameSelect },
} as const;

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

/**
 * Volunteer check-in link validation: scope and expiry, never the hash — nor
 * the link's name, which may be a person's and must not reach the logs (#529).
 */
export const volunteerTokenAuthSelect = {
  id: true,
  competitionId: true,
  expiresAt: true,
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
  // Programme saved by the club (#442): its events are never replaced.
  programEditedAt: true,
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

/**
 * Account deletion (#395): the deleted user's own registrations, read before
 * the transaction deletes them. Event + bib identify the couple, to find the
 * partner's legacy registration and the couple's result row.
 */
export const registrationEventBibSelect = {
  eventId: true,
  bibNumber: true,
} as const;

/**
 * Account deletion (#395): registrations naming the deleted user as partner.
 * Event + holder locate the couple's result row, attached to the holder.
 */
export const registrationEventHolderSelect = {
  eventId: true,
  userId: true,
} as const;

/** Account deletion (#395): partner registrations to confirm by name. */
export const registrationPartnerNameSelect = {
  id: true,
  partnerName: true,
} as const;

/**
 * Backfill of Registration.partnerUserId (#395): the registration, its
 * holder's name (to confirm the reciprocal partnerName) and its couple key.
 */
export const registrationPartnerBackfillSelect = {
  id: true,
  eventId: true,
  userId: true,
  bibNumber: true,
  partnerName: true,
  user: { select: userNameSelect },
} as const;

/**
 * Account deletion (#423): the user's partnerships, to locate their half of
 * the couple label in the inter-club notifications sent to organisers.
 */
export const partnershipMembersSelect = {
  id: true,
  user1Id: true,
  user2Id: true,
} as const;

/** Account deletion (#423): notifications whose body may name the user. */
export const notificationNameScrubSelect = {
  id: true,
  body: true,
  data: true,
} as const;

/**
 * Parental consent (#61): the minor an action is about. The birth date decides
 * whether consent is required; the first name personalises the parent's
 * e-mail; the login address must not be given as the parent's.
 */
export const parentalConsentSubjectSelect = {
  id: true,
  firstName: true,
  email: true,
  birthDate: true,
} as const;

/** Avis de mise à jour de la politique de confidentialité (#734). */
export const privacyPolicySeenVersionSelect = {
  privacyPolicySeenVersion: true,
} as const;

/** Parental consent (#61): birth date only, for the health-data gate. */
export const userBirthDateSelect = {
  birthDate: true,
} as const;

/**
 * Parental consent (#61): what the minor's app shows of the latest request.
 * Never the token hash nor the hash of the parent's address.
 */
export const parentalConsentStateSelect = {
  status: true,
  parentEmailMasked: true,
  requestedAt: true,
  expiresAt: true,
  grantedAt: true,
  revokedAt: true,
} as const;

/**
 * Parental consent (#61): the request a link designates, as the parent's page
 * needs it — the minor's first name only, never their e-mail or birth date.
 */
export const parentalConsentTokenTargetSelect = {
  id: true,
  userId: true,
  status: true,
  expiresAt: true,
  grantedAt: true,
  revokedAt: true,
  user: { select: { firstName: true } },
} as const;

/**
 * GDPR export (#61): the consent trail of the account. Neither the token hash
 * (a secret) nor the parent's address hash (data of a third party).
 */
export const parentalConsentExportSelect = {
  status: true,
  parentEmailMasked: true,
  cguVersion: true,
  requestedAt: true,
  expiresAt: true,
  grantedAt: true,
  revokedAt: true,
  supersededAt: true,
} as const;

/**
 * Club competition editor (#442): competition fields the programme read and
 * write need (calendar day of the schedule, Article 8 type, FFD origin).
 */
export const competitionProgramHeaderSelect = {
  id: true,
  date: true,
  competitionType: true,
  ffdId: true,
  eventsSource: true,
  programEditedAt: true,
} as const;

/** An event of the club editor, with what locks it (registrations, results). */
export const competitionProgramEventSelect = {
  id: true,
  eventKind: true,
  eventType: true,
  category: true,
  ageGroup: true,
  ageGroups: true,
  level: true,
  openLevels: true,
  position: true,
  _count: { select: { registrations: true, results: true } },
} as const;

/** A schedule slot of the club editor. */
export const competitionProgramScheduleSelect = {
  id: true,
  startTime: true,
  startClock: true,
  durationMinutes: true,
  type: true,
  title: true,
  eventId: true,
} as const;
