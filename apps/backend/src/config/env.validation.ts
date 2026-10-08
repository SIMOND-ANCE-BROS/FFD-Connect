import { plainToInstance } from "class-transformer";
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  validateSync,
  Min,
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

  // HelloAsso (paiement — webhook secret requis si les webhooks sont configurés)
  @IsString()
  @IsOptional()
  HELLOASSO_WEBHOOK_SECRET?: string;

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

  // Clé API Gemini (Google AI). N'est plus lue par le module TTS (la réécriture
  // d'annonce a été retirée : le texte est synthétisé tel quel). Conservée
  // optionnelle pour ne pas casser les environnements qui la définissent encore.
  @IsString()
  @IsOptional()
  GOOGLE_API_KEY?: string;

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
