import { plainToInstance } from "class-transformer";
import { HELLOASSO_API_URLS } from "../payment/helloasso-api-urls";
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  validateSync,
  Min,
  Matches,
  Max,
  MinLength,
} from "class-validator";

/**
 * Enum pour les environnements disponibles
 */
enum Environment {
  Development = "development",
  Production = "production",
  Test = "test",
}

/**
 * 32 octets en base64 : 43 caractères + un `=` de remplissage. Une valeur vide
 * vaut absence (chiffrement désactivé), pas une erreur.
 */
const SECRET_KEY_BASE64 = /^\s*(?:[A-Za-z0-9+/]{43}=)?\s*$/;
const SECRET_KEY_MESSAGE =
  "must be a base64-encoded 32-byte key (openssl rand -base64 32)";

/**
 * Classe de validation pour les variables d'environnement
 *
 * Valide que toutes les variables d'environnement requises sont présentes
 * et correctement typées au démarrage de l'application.
 */
class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV?: Environment = Environment.Development;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT?: number = 3000;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32, {
    message: "JWT_SECRET must be at least 32 characters long for security",
  })
  JWT_SECRET!: string;

  @IsString()
  @IsOptional()
  REDIS_HOST?: string = "localhost";

  @IsNumber()
  @IsOptional()
  REDIS_PORT?: number = 6379;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD?: string;

  @IsString()
  @IsOptional()
  CORS_ORIGINS?: string;

  @IsString()
  @IsOptional()
  FFD_API_BASE_URL?: string;

  @IsString()
  @IsOptional()
  FFD_API_PATH?: string;

  @IsString()
  @IsOptional()
  FFD_DANCE_FAMILIES?: string;

  @IsString()
  @IsOptional()
  FFD_EVENT_CATEGORY?: string;

  @IsNumber()
  @IsOptional()
  FFD_ITEMS_PER_PAGE?: number = 100;

  // TEMPORAIRE : déduction des épreuves depuis la description / la circulaire FFD
  @IsIn(["true", "false"])
  @IsOptional()
  FFD_DEDUCE_EVENTS?: string;

  // Sentry (optionnel — si absent, le tracking est désactivé)
  @IsString()
  @IsOptional()
  SENTRY_DSN?: string;

  // Environnement Sentry (sépare prod/staging, tous deux NODE_ENV=production)
  @IsString()
  @IsOptional()
  SENTRY_ENVIRONMENT?: string;

  // Version déployée (SHA git injecté par le pipeline) — exposée par /health
  // pour vérifier que la CI a bien déployé le bon build.
  @IsString()
  @IsOptional()
  APP_VERSION?: string;

  // Email (Resend)
  @IsString()
  @IsOptional()
  RESEND_API_KEY?: string;

  // Notifications push (Firebase)
  @IsString()
  @IsOptional()
  FIREBASE_PROJECT_ID?: string;

  @IsString()
  @IsOptional()
  FIREBASE_CLIENT_EMAIL?: string;

  @IsString()
  @IsOptional()
  FIREBASE_PRIVATE_KEY?: string;

  // Email (expéditeur Resend)
  @IsString()
  @IsOptional()
  RESEND_FROM_EMAIL?: string;

  // URL frontend (liens dans les emails de reset de mot de passe)
  @IsString()
  @IsOptional()
  FRONTEND_URL?: string;

  // WDSF (World DanceSport Federation — optionnel)
  @IsString()
  @IsOptional()
  WDSF_API_KEY?: string;

  @IsString()
  @IsOptional()
  WDSF_USERNAME?: string;

  @IsString()
  @IsOptional()
  WDSF_PASSWORD?: string;

  @IsString()
  @IsOptional()
  WDSF_API_V1_URL?: string;

  @IsString()
  @IsOptional()
  WDSF_API_V2_URL?: string;

  // GitHub (rapports de bugs)
  @IsString()
  @IsOptional()
  GITHUB_TOKEN?: string;

  @IsString()
  @IsOptional()
  GITHUB_OWNER?: string;

  @IsString()
  @IsOptional()
  GITHUB_REPO?: string;

  // HelloAsso (#404). Hôte de l'API : production par défaut, sandbox possible
  // en staging. Liste fermée : les identifiants des clubs ne partent que vers
  // HelloAsso.
  @IsIn(HELLOASSO_API_URLS)
  @IsOptional()
  HELLOASSO_API_URL?: string;

  // Clé de signature `signatureKey` des notifications HelloAsso — compte
  // PARTENAIRE uniquement (les associations ne reçoivent pas de signature).
  // Présente ⇒ toute notification sans `x-ha-signature` valide est rejetée.
  @IsString()
  @IsOptional()
  HELLOASSO_SIGNATURE_KEY?: string;

  // Obsolète depuis #404 (HelloAsso n'a jamais envoyé l'en-tête attendu) :
  // ignoré, gardé pour ne pas refuser le démarrage d'un environnement qui le
  // définit encore.
  @IsString()
  @IsOptional()
  HELLOASSO_WEBHOOK_SECRET?: string;

  // Chiffrement au repos des secrets tiers en base (secret HelloAsso des clubs,
  // #389). Clé AES-256 de 32 octets encodée en base64 (`openssl rand -base64
  // 32`), alimentée par Key Vault. Absente ⇒ chiffrement désactivé (secrets
  // écrits et lus en clair, avertissement au démarrage) : le backend démarre.
  // Présente mais mal formée ⇒ démarrage refusé.
  @Matches(SECRET_KEY_BASE64, { message: SECRET_KEY_MESSAGE })
  @IsOptional()
  SECRETS_ENCRYPTION_KEY?: string;

  // Clé précédente pendant une rotation : sert uniquement à déchiffrer, les
  // valeurs qu'elle ouvre sont rechiffrées avec la clé courante.
  @Matches(SECRET_KEY_BASE64, { message: SECRET_KEY_MESSAGE })
  @IsOptional()
  SECRETS_ENCRYPTION_KEY_PREVIOUS?: string;

  // URL de l'application (utilisée dans les emails et callbacks HelloAsso)
  @IsString()
  @IsOptional()
  APP_URL?: string;

  // Azure AI Vision (OCR — si AZURE_VISION_ENDPOINT absent, OCR tourne en mode
  // mock). Auth par managed identity (aucune clé). Endpoint type
  // https://<nom>.cognitiveservices.azure.com
  @IsString()
  @IsOptional()
  AZURE_VISION_ENDPOINT?: string;

  // Azure AI Speech (TTS). Endpoint à sous-domaine custom requis pour l'auth
  // managed identity (https://<nom>.cognitiveservices.azure.com).
  @IsString()
  @IsOptional()
  AZURE_SPEECH_ENDPOINT?: string;

  // Voix neurale FR pour le TTS (défaut fr-FR-DeniseNeural).
  @IsString()
  @IsOptional()
  AZURE_SPEECH_VOICE?: string;

  // ARM resource id du compte Speech. Spécificité Speech : l'auth Entra ID exige
  // un token encapsulé "aad#{resourceId}#{token}" (les autres services Cognitive
  // acceptent un bearer brut). Fourni par la sortie Terraform azure_speech_resource_id.
  @IsString()
  @IsOptional()
  AZURE_SPEECH_RESOURCE_ID?: string;

  // Firebase Service Account (notifications push). Priorité au JSON complet
  // (injecté depuis Key Vault) : sur Azure Container Apps il n'y a pas de
  // système de fichiers où déposer une clé. Le chemin reste en repli pour le
  // développement local. Aucun des deux → notifications en mode mock.
  @IsString()
  @IsOptional()
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;

  @IsString()
  @IsOptional()
  FIREBASE_SERVICE_ACCOUNT_PATH?: string;

  // Azure Blob Storage (uploads sans état — pistes audio + certificats de licence)
  // Managed identity via ACCOUNT_NAME, ou connection string. Si aucun n'est
  // fourni, le stockage blob est désactivé (fallback local / mode test).
  @IsString()
  @IsOptional()
  AZURE_STORAGE_ACCOUNT_NAME?: string;

  // Conteneur des pistes audio (défaut "tracks")
  @IsString()
  @IsOptional()
  AZURE_STORAGE_CONTAINER?: string;

  // Conteneur des documents de licence (certificats médicaux/licence, défaut "uploads")
  @IsString()
  @IsOptional()
  AZURE_STORAGE_UPLOADS_CONTAINER?: string;

  // Signature HMAC des QR de licence (#168). Absent ⇒ QR non signés et non
  // vérifiés (équivalent au mode « off ») ; le backend démarre quand même.
  // Moins de 32 caractères ⇒ ignoré (même plancher que JWT_SECRET).
  @IsString()
  @IsOptional()
  QR_SIGNING_SECRET?: string;

  // Vérification au check-in : off | warn (défaut) | enforce.
  @IsIn(["off", "warn", "enforce"])
  @IsOptional()
  QR_SIGNATURE_MODE?: string;

  // QR d'entrée tournant vérifiable hors ligne (#24, ADR-0023) : clé privée
  // Ed25519, PEM PKCS#8 (les `\n` littéraux sont acceptés). Absente ou
  // invalide ⇒ fonctionnalité désactivée, l'app garde le QR statique ; le
  // backend démarre.
  @IsString()
  @IsOptional()
  ENTRY_QR_SIGNING_KEY?: string;

  // Clés publiques brutes (base64url, séparées par des virgules) des clés de
  // signature précédentes, encore acceptées pendant une rotation (≤ 12 h).
  @IsString()
  @IsOptional()
  ENTRY_QR_RETIRED_PUBLIC_KEYS?: string;

  // Pass Apple Wallet de la licence (#162). Les cinq sont requises pour activer
  // la fonctionnalité ; une seule absente ou invalide ⇒ fonctionnalité
  // désactivée (503 + `appleWalletAvailable: false`), le backend démarre.
  // Contenus PEM (les `\n` littéraux sont acceptés), clé privée NON chiffrée.
  @IsString()
  @IsOptional()
  WALLET_APPLE_PASS_CERT?: string;

  @IsString()
  @IsOptional()
  WALLET_APPLE_PASS_KEY?: string;

  @IsString()
  @IsOptional()
  WALLET_APPLE_WWDR_CERT?: string;

  @IsString()
  @IsOptional()
  WALLET_APPLE_PASS_TYPE_ID?: string;

  @IsString()
  @IsOptional()
  WALLET_APPLE_TEAM_ID?: string;

  // Reverse-proxy hops trusted to compute the client IP (`trust proxy`, #182).
  // Unset: 1 in production (Container Apps ingress), 0 elsewhere.
  @IsInt()
  @Min(0)
  @Max(10)
  @IsOptional()
  TRUST_PROXY_HOPS?: number;

  // Minutes before a user may re-hold a seat they let expire (#455).
  // Unset: 30. 0 disables the cooldown.
  @IsInt()
  @Min(0)
  @Max(1440)
  @IsOptional()
  SEAT_REHOLD_COOLDOWN_MINUTES?: number;

  // Fonctionnalités optionnelles
  @IsString()
  @IsOptional()
  ENABLE_IP_BLACKLIST?: string;

  // "true" déclenche le seed de pistes de TEST (métronomes ffmpeg royalty-free)
  // au démarrage du conteneur, après les migrations (docker-entrypoint.sh).
  // Réservé à staging/beta — ne jamais activer en prod.
  @IsString()
  @IsOptional()
  SEED_TEST_TRACKS?: string;

  // "true" : à l'inscription, un numéro de licence inconnu est auto-créé au lieu
  // d'être refusé (bêta-testeurs sans licence pré-seedée). Staging UNIQUEMENT —
  // ne jamais activer en prod. Toute autre valeur = comportement normal.
  @IsString()
  @IsOptional()
  BETA_AUTO_LICENSE?: string;
}

/**
 * Valide et transforme les variables d'environnement
 *
 * @param config - Configuration brute depuis les variables d'environnement
 * @returns Configuration validée et typée
 * @throws Error si la validation échoue
 */
export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors
      .map((error) => Object.values(error.constraints ?? {}).join(", "))
      .join("; ");
    throw new Error(
      `Erreur de validation des variables d'environnement: ${errorMessages}`,
    );
  }

  return validatedConfig;
}
