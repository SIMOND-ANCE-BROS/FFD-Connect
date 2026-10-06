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
