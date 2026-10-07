import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Application from "expo-application";
import Constants from "expo-constants";

const LOCAL_IP: string =
  (process.env.EXPO_PUBLIC_LOCAL_IP as string | undefined) ?? "192.168.1.45";
const PORT = 3000;
const METRO_PORT = 8081;

/** Variante d'app (dev/preview/production), issue de app.config.js. */
export const APP_ENV: string =
  (process.env.EXPO_PUBLIC_APP_ENV as string | undefined) ?? "development";
/** Build production (App Store). preview = beta, development = dev client. */
export const IS_PROD = APP_ENV === "production";
/** Variante preview (staging) — gate des outils de test (ex. switch de profil). */
export const IS_PREVIEW = APP_ENV === "preview";

/**
 * Identité du binaire, au format des stores et des tags `beta-<version>-<plateforme>-<build>` :
 * version marketing + numéro de build NATIFS, ceux que TestFlight et Play
 * affichent. Pas `expoConfig` : sous OTA il vient du manifeste de la mise à
 * jour, et `android.versionCode` y vaut 1 en dur.
 */
export const APP_VERSION: string =
  Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "";
export const APP_BUILD: string = Application.nativeBuildVersion ?? "";
/** « 1.0.0 (85) » : le libellé de TestFlight et de Play. */
export const APP_VERSION_LABEL: string = APP_BUILD
  ? `${APP_VERSION} (${APP_BUILD})`
  : APP_VERSION;
/** SHA git (7 caractères) du JS qui tourne, celui des tags et releases. Posé par metro.config.js. */
export const APP_GIT_SHA: string =
  (process.env.EXPO_PUBLIC_GIT_SHA as string | undefined) ?? "";
const rawRuntime = Constants.expoConfig?.runtimeVersion;
export const APP_RUNTIME_VERSION: string =
  typeof rawRuntime === "string" ? rawRuntime : "";
/**
 * Libellé de la variante, une par canal EAS : preview et beta sont deux apps
 * distinctes (bundle ids, canaux, distribution), elles ne partagent pas de nom.
 */
export function envLabel(env: string, os: string = Platform.OS): string {
  switch (env) {
    case "production":
      return "Production";
    case "beta":
      return os === "android"
        ? "Bêta (Google Play, test fermé)"
        : "Bêta (TestFlight)";
    case "preview":
      return "Preview (staging)";
    default:
      return "Développement";
  }
}
export const APP_ENV_LABEL: string = envLabel(APP_ENV);

/** Timeout des requêtes API en millisecondes (30 s) */
export const API_TIMEOUT_MS = 30000;

/** Nombre de tentatives de retry pour les requêtes API (interceptor axios) */
export const API_RETRY_MAX_RETRIES = 2;
/** Délai initial en ms entre deux tentatives de retry */
export const API_RETRY_INITIAL_DELAY_MS = 1000;

/** URL de l'API en production (builds Expo/EAS)
 *  Priorité:
 *  - EXPO_PUBLIC_API_URL (EAS / Expo)
 *  - API_URL (legacy .env local)
 *  Pas de valeur statique par défaut : si rien n'est défini,
 *  BACKEND_URL sera vide en production.
 */
const PRODUCTION_API_URL: string =
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ??
  (process.env.API_URL as string | undefined) ??
  "";

// Cache for emulator detection (Device.isDevice is sync, but we keep async pattern for consistency)
let isEmulatorCache: boolean | null = null;
let emulatorCheckPromise: Promise<boolean> | null = null;

// Auto-detect if running on emulator/simulator
const checkIsEmulator = async (): Promise<boolean> => {
  if (isEmulatorCache !== null) {
    return isEmulatorCache;
  }

  if (emulatorCheckPromise) {
    return emulatorCheckPromise;
  }

  emulatorCheckPromise = Promise.resolve()
    .then(() => {
      // expo-device: Device.isDevice returns false for emulators/simulators
      if (Platform.OS === "web") {
        isEmulatorCache = false; // Web is never an emulator
        return false;
      }

      // For native platforms, Device.isDevice is false for emulators
      const isDevice = Device.isDevice;
      isEmulatorCache = !isDevice;
      return !isDevice;
    })
    .catch(() => {
      // Fallback: assume simulator if detection fails
      isEmulatorCache = Platform.OS === "ios";
      return isEmulatorCache;
    });

  return emulatorCheckPromise;
};

// Synchronous version with best-effort detection
// For iOS: localhost works for simulator, LOCAL_IP works for both simulator and physical device
// For Android: 10.0.2.2 for emulator, LOCAL_IP for physical device
const getBackendUrl = (): string => {
  if (__DEV__) {
    if (Platform.OS === "ios") {
      // iOS: Use LOCAL_IP for both simulator and physical device
      // iOS Simulator can access the Mac's localhost via LOCAL_IP
      // This makes it work automatically for both cases
      return `http://${LOCAL_IP}:${PORT}/api/v1`;
    } else if (Platform.OS === "android") {
      // Android: Try to detect, but default to emulator address
      // Physical devices will need LOCAL_IP, but we can't detect synchronously
      // So we use a runtime check via async function below
      return `http://10.0.2.2:${PORT}/api/v1`; // Default to emulator
    }
  }
  // Production - utilise l'API déployée
  return PRODUCTION_API_URL;
};

// Async version for runtime detection (use this in components that can handle async)
export const getBackendUrlAsync = async (): Promise<string> => {
  if (__DEV__) {
    const isEmulator = await checkIsEmulator();

    if (Platform.OS === "ios") {
      // iOS Simulator can use LOCAL_IP or localhost
      // Physical device needs LOCAL_IP
      return `http://${LOCAL_IP}:${PORT}/api/v1`;
    } else if (Platform.OS === "android") {
      if (isEmulator) {
        return `http://10.0.2.2:${PORT}/api/v1`; // Android Emulator
      }
      return `http://${LOCAL_IP}:${PORT}/api/v1`; // Physical Android device
    }
  }
  return PRODUCTION_API_URL;
};

// Export sync version (works for iOS automatically, Android defaults to emulator en dev)
export const BACKEND_URL: string = getBackendUrl();
export const API_URL: string = BACKEND_URL;

/**
 * Base URL pour les fichiers statiques (uploads/, artwork…). Les routes
 * `/uploads` sont servies à la racine par `ServeStaticModule` (cf.
 * `app.module.ts`), pas sous le préfixe `/api/v1`. On strippe le suffixe
 * pour éviter les 404 sur audio/jpg.
 */
export const STATIC_BASE_URL: string = BACKEND_URL.replace(
  /\/api\/v\d+\/?$/,
  "",
);

/** Endpoint /health (racine, hors préfixe /api/v1) — sert au polling de réveil. */
export const HEALTH_URL: string = STATIC_BASE_URL
  ? `${STATIC_BASE_URL}/health`
  : "";

/**
 * Réveil à la demande du backend (Container App en minReplicas=0 hors usage).
 * Sur Container Apps, TOUTE requête HTTP réveille l'app : le polling /health
 * suffit. WAKE_URL (Azure Function héritée de l'époque VM) est un coup de
 * pouce optionnel — le réveil fonctionne sans elle.
 * - EXPO_PUBLIC_WAKE_URL : endpoint optionnel qui force le démarrage.
 * - EXPO_PUBLIC_WAKE_KEY : clé partagée simple envoyée en header `X-Wake-Key`.
 */
export const WAKE_URL: string =
  (process.env.EXPO_PUBLIC_WAKE_URL as string | undefined) ?? "";
export const WAKE_KEY: string =
  (process.env.EXPO_PUBLIC_WAKE_KEY as string | undefined) ?? "";

/**
 * Active le mécanisme de réveil (wrapper fetch, pré-réveil, réveil axios).
 * Désactivé en dev : le backend est local, pas de scale-to-zero à réveiller.
 * Ne dépend PAS de WAKE_URL — supprimer la Function Azure ne doit pas
 * désactiver silencieusement l'UX de réveil.
 */
export const WAKE_ENABLED: boolean =
  (typeof __DEV__ === "undefined" || !__DEV__) && HEALTH_URL !== "";

/** Active les logs détaillés pour déboguer player/thumbnails (dev ou EXPO_PUBLIC_DEBUG_PLAYER=1 en EAS) */
export const DEBUG_PLAYER =
  (typeof __DEV__ !== "undefined" && __DEV__) ||
  process.env.EXPO_PUBLIC_DEBUG_PLAYER === "1";

const isProduction = typeof __DEV__ === "undefined" || __DEV__ === false;
if (
  DEBUG_PLAYER ||
  (isProduction && (BACKEND_URL === "" || BACKEND_URL.startsWith("http:")))
) {
  const safeUrl =
    BACKEND_URL === ""
      ? "(vide)"
      : BACKEND_URL.replace(/^(\w+):\/\/([^/]+).*/, "$1://$2");
  // eslint-disable-next-line no-console
  console.log("[config] BACKEND_URL:", safeUrl);
  if (isProduction && BACKEND_URL !== "" && BACKEND_URL.startsWith("http:")) {
    console.warn(
      "[config] iOS bloque souvent les requêtes HTTP (ATS). Utilisez HTTPS pour EXPO_PUBLIC_API_URL.",
    );
  }
}

// Google Places API key
// Priorité:
// - EXPO_PUBLIC_GOOGLE_API_KEY : le SEUL nom inliné dans le bundle client par
//   Expo (babel-preset-expo n'inline que le préfixe EXPO_PUBLIC_) → c'est donc
//   le seul qui fonctionne sur un build EAS / device. Nom documenté dans
//   apps/client/.env.example ; le secret EAS (beta/preview/production) doit
//   porter EXACTEMENT ce nom.
// - EXPO_GOOGLE_API_KEY / GOOGLE_API_KEY : fallback .env local (dev) uniquement,
//   NON inlinés sur device — ne jamais compter dessus pour un build.
export const EXPO_PUBLIC_GOOGLE_API_KEY: string =
  (process.env.EXPO_PUBLIC_GOOGLE_API_KEY as string | undefined) ??
  (process.env.EXPO_GOOGLE_API_KEY as string | undefined) ??
  (process.env.GOOGLE_API_KEY as string | undefined) ??
  "";

// Google Static Maps key (carte statique du détail compétition).
// Était codée en dur dans CompetitionMapCard (fuite — secret-scanning) :
// fournir une clé RESTREINTE via EXPO_PUBLIC_GOOGLE_MAPS_KEY (secret EAS).
// À défaut, retombe sur la clé Google partagée ci-dessus.
export const EXPO_PUBLIC_GOOGLE_MAPS_KEY: string =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY as string | undefined) ??
  EXPO_PUBLIC_GOOGLE_API_KEY;

// Metro bundler URL - React Native handles this automatically when Metro listens on 0.0.0.0
// For iOS, both simulator and physical device can use LOCAL_IP
export const METRO_URL = `http://${LOCAL_IP}:${METRO_PORT}`;
