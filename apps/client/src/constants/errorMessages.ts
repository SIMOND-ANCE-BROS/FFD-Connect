/**
 * Constantes pour les messages d'erreur de l'application
 *
 * Ces constantes permettent d'avoir des messages cohérents dans toute l'application
 * et facilitent l'internationalisation future.
 */
export const ERROR_MESSAGES = {
  // Authentification
  LOGIN_FAILED: "Échec de la connexion. Vérifiez vos identifiants.",
  LOGIN_REQUIRED: "Veuillez saisir votre identifiant et votre mot de passe.",
  INVALID_CREDENTIALS: "Identifiants invalides.",
  SERVER_ERROR: "Problème serveur. Veuillez réessayer plus tard.",

  // Inscriptions
  REGISTRATION_FAILED: "L'inscription a échoué",
  REGISTRATION_SUCCESS: "Inscription confirmée",
  UNREGISTRATION_FAILED: "La désinscription a échoué",
  UNREGISTRATION_SUCCESS: "Désinscription confirmée",
  ALREADY_REGISTERED: "Vous êtes déjà inscrit à cet événement",

  // Compétitions
  COMPETITION_LOAD_FAILED: "Échec du chargement des détails de la compétition",
  COMPETITION_NOT_FOUND: "Compétition non trouvée",

  // PDF & Partage
  PDF_GENERATION_FAILED: "La génération du PDF a échoué",
  PDF_SHARE_FAILED: "Le partage du PDF a échoué",

  // WDSF
  WDSF_VERIFICATION_FAILED: "Erreur de vérification de la licence WDSF",
  WDSF_VERIFICATION_ERROR: "Erreur de vérification",

  // Renouvellement de licence
  RENEWAL_LOAD_FAILED: "Impossible de charger la demande de renouvellement",
  RENEWAL_UPLOAD_FAILED: "Le dépôt du document a échoué",
  RENEWAL_SUBMIT_FAILED: "La soumission de la demande a échoué",
  RENEWAL_MEDICAL_REQUIRED: "Le certificat médical est obligatoire",
  RENEWAL_LICENSE_CERT_REQUIRED: "Le certificat de licence est obligatoire",

  // Réseau
  NETWORK_ERROR: "Erreur de connexion. Vérifiez votre connexion internet.",
  TIMEOUT_ERROR: "La requête a expiré. Veuillez réessayer.",

  // Générique
  UNKNOWN_ERROR: "Une erreur inattendue est survenue",
  OPERATION_FAILED: "L'opération a échoué",
  LOADING_FAILED: "Échec du chargement des données",

  // Validation
  REQUIRED_FIELD: "Ce champ est requis",
  INVALID_EMAIL: "Adresse email invalide",
  INVALID_FORMAT: "Format invalide",
  PASSWORD_TOO_SHORT: "Le mot de passe doit contenir au moins 6 caractères",
} as const;

/**
 * Messages de succès
 */
export const SUCCESS_MESSAGES = {
  LOGIN_SUCCESS: "Connexion réussie",
  REGISTRATION_SUCCESS: "Inscription confirmée",
  UNREGISTRATION_SUCCESS: "Désinscription confirmée",
  PDF_GENERATED: "PDF généré avec succès",
  WDSF_VERIFIED: "Licence WDSF vérifiée avec succès",
  SAVED: "Enregistré avec succès",
} as const;

/**
 * Type pour les clés de messages d'erreur
 */
export type ErrorMessageKey = keyof typeof ERROR_MESSAGES;
export type SuccessMessageKey = keyof typeof SUCCESS_MESSAGES;
