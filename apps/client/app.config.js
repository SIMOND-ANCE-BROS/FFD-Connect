/**
 * Expo Configuration
 * Supports both Expo and bare React Native workflows
 *
 * Multi-variant (dev / preview / beta / prod) : bundle id + nom varient selon
 * EXPO_PUBLIC_APP_ENV pour que les 4 apps coexistent sur un même appareil.
 * Un bundle id = un app Firebase : la config FCM est donc résolue PAR VARIANTE
 * (voir resolveFirebaseFile plus bas), pas réservée à la prod.
 */
const fs = require("fs");
const path = require("path");

const APP_ENV = process.env.EXPO_PUBLIC_APP_ENV || "development";
const IS_PROD = APP_ENV === "production";
const IS_BETA = APP_ENV === "beta";
const IS_PREVIEW = APP_ENV === "preview";

// Four coexisting iOS variants, each with a distinct bundle id so they can be
// installed side by side on one device:
//   development → .dev      (dev client)
//   preview     → .staging  (ad-hoc / internal distribution, staging API)
//   beta        → .beta     (TestFlight, staging API) — distinct from preview
//                           on purpose so a TestFlight install does not clobber
//                           the ad-hoc preview install
//   production  → base id   (App Store)
const BUNDLE_ID = IS_PROD
  ? "fr.ffdanse.connect"
  : IS_BETA
    ? "fr.ffdanse.connect.beta"
    : IS_PREVIEW
      ? "fr.ffdanse.connect.staging"
      : "fr.ffdanse.connect.dev";
const APP_NAME = IS_PROD
  ? "FFD Connect"
  : IS_BETA
    ? "FFD Connect Beta"
    : IS_PREVIEW
      ? "FFD Connect Preview"
      : "FFD Connect Dev";

// Icône par variante : ruban d'angle (BETA/PREV/DEV) pour distinguer les apps
// sur l'écran d'accueil. Prod garde l'icône propre. Généré par
// scripts/make-variant-icons.js. (Change natif → visible au prochain build.)
const APP_ICON = IS_PROD
  ? "./assets/icon.png"
  : IS_BETA
    ? "./assets/icon.beta.png"
    : IS_PREVIEW
      ? "./assets/icon.preview.png"
      : "./assets/icon.dev.png";

// --- Firebase / FCM : une config par variante ------------------------------
// Chaque variante a son propre bundle id (voir BUNDLE_ID), donc son propre app
// Firebase dans le projet ffd-connect-app — et donc son propre fichier de
// config. Convention (un fichier par variante, <env> = valeur de
// EXPO_PUBLIC_APP_ENV : development | preview | beta | production) :
//
//   apps/client/firebase/GoogleService-Info.<env>.plist   (iOS)
//   apps/client/firebase/google-services.<env>.json       (Android)
//
// Ces fichiers ne sont JAMAIS committés (cf. .gitignore + firebase/README.md) :
// ils se téléchargent depuis la Firebase Console. Pour un build EAS/CI (checkout
// neuf, donc pas de fichier sur disque), les exposer en variable
// d'environnement EAS de type "file", nommée par variante — EAS écrit le fichier
// et la variable contient son chemin, donc la même résolution s'applique.
// Le suffixe de variante est obligatoire : preview et beta partagent
// l'environnement EAS "preview" mais ont deux bundle ids distincts.
//
// Il n'y a plus de repli "legacy prod" vers des fichiers versionnés à la racine.
// Ceux-ci pointaient sur `ffd-connect-35b86`, un projet Firebase qui n'existe
// plus : la prod était la SEULE variante à ne pas avoir de fichier par variante,
// donc la seule à tomber sur ce repli — elle aurait embarqué la config d'un
// projet mort, avec des push silencieusement inopérantes. Toutes les variantes
// passent désormais par le même chemin (env EAS, puis firebase/<variante>).
const FIREBASE_DIR = "./firebase";
const FIREBASE_FILES = {
  ios: {
    envVar: `GOOGLE_SERVICE_INFO_PLIST_${APP_ENV.toUpperCase()}`,
    variant: `${FIREBASE_DIR}/GoogleService-Info.${APP_ENV}.plist`,
  },
  android: {
    envVar: `GOOGLE_SERVICES_JSON_${APP_ENV.toUpperCase()}`,
    variant: `${FIREBASE_DIR}/google-services.${APP_ENV}.json`,
  },
};

/**
 * Retourne le chemin de la config Firebase de la variante courante s'il existe
 * sur disque (env EAS de type "file" d'abord, puis firebase/<variante>), sinon
 * null.
 *
 * @param {"ios" | "android"} platform
 * @returns {string | null}
 */
function resolveFirebaseFile(platform) {
  const { envVar, variant } = FIREBASE_FILES[platform];
  const candidates = [process.env[envVar], variant];
  return (
    candidates.find(
      (candidate) =>
        candidate && fs.existsSync(path.resolve(__dirname, candidate)),
    ) ?? null
  );
}

// Variantes distribuées (OTA par channel, runtimeVersion = empreinte native) :
// Firebase y est TOUJOURS actif, que le fichier soit présent ou non.
//
// Pourquoi ne pas se fier à la présence du fichier, comme avant : le fichier
// n'existe que sur le builder EAS (variable d'environnement EAS de type "file",
// secrète, illisible ailleurs). L'empreinte calculée sur le runner GitHub ou
// sur un poste de dev voyait donc une config SANS Firebase (plugins, entitlement
// APNs, UIBackgroundModes en moins) et celle du builder une config AVEC : deux
// runtimeVersion différentes pour le même commit. EAS refuse alors le build
// ("Runtime version mismatch" en phase Configure expo-updates) et aucune OTA
// n'atteint plus aucun binaire. La config doit être une fonction du commit et
// de la variante, jamais de la présence d'un secret.
//
// Corollaire : le contenu du fichier est exclu de l'empreinte
// (fingerprint.config.js), et un prebuild d'une de ces variantes exige le
// fichier (secret EAS sur le builder, firebase/ en local) — le plugin RNFB
// échoue sinon, ce qui vaut mieux qu'un binaire distribué sans push.
const FIREBASE_REQUIRED_VARIANTS = new Set(["preview", "beta", "production"]);
const FIREBASE_REQUIRED = FIREBASE_REQUIRED_VARIANTS.has(APP_ENV);

// googleServicesFile n'est posé QUE si le fichier existe, y compris pour une
// variante distribuée. Le poser vers un chemin absent casse `eas build` avant
// même l'envoi au builder : eas-cli résout les entitlements iOS côté client en
// jouant les mods en mode introspection, et le mod infoPlist d'Expo
// (Google.js, setGoogleSignInReversedClientId) lit ce fichier → ENOENT sur le
// runner GitHub comme sur un poste de dev, qui n'ont jamais le secret.
//
// Ce n'est pas un binaire sans push en silence : les plugins RNFB restent
// chargés (FIREBASE_REQUIRED), et au prebuild du builder (mods complets, pas
// d'introspection) @react-native-firebase/app lève "Path to
// GoogleService-Info.plist is not defined" (mod Xcode) / "Path to
// google-services.json is not defined" (mod Android) si le fichier manque.
// Ce champ n'entre pas dans l'empreinte (@expo/fingerprint le retire de
// expoConfig, et le contenu du fichier est ignoré par fingerprint.config.js) :
// sa présence ou son absence ne change pas la runtimeVersion.
const FIREBASE_IOS_FILE = resolveFirebaseFile("ios");
const FIREBASE_ANDROID_FILE = resolveFirebaseFile("android");
// development : plugins chargés seulement si un fichier est déposé (le dev
// client n'a pas de channel OTA, son empreinte n'a pas à être stable), pour que
// `expo run:ios` marche sans config Firebase.
const FIREBASE_ENABLED =
  FIREBASE_REQUIRED || Boolean(FIREBASE_IOS_FILE || FIREBASE_ANDROID_FILE);

// Entitlement APNs. Sans lui, iOS n'enregistre jamais l'app auprès d'APNs :
// messaging().getToken() échoue, aucun token n'est produit, donc aucune
// notification n'arrive — quel que soit le projet Firebase ou la clé .p8.
// Et le build réussit : [FIRApp configure] s'exécute, UIBackgroundModes est
// posé, tout paraît correct. L'oubli ne se découvre qu'à l'installation.
//
// Rien dans l'arbre ne l'écrivait : le plugin @react-native-firebase/messaging
// n'a qu'un mod Android, celui de @react-native-firebase/app ne touche pas aux
// entitlements, et expo-notifications — le seul writer — est commenté plus bas
// (gelé pendant l'investigation SIGABRT iOS 26).
//
// La valeur doit correspondre au profil de provisioning utilisé, et se tromper
// est silencieux dans les deux sens. Un binaire TestFlight signé en
// distribution avec "development" ne reçoit aucune push de production.
//   - profil de développement (dev client, `expo run:ios` local) → development
//   - toute distribution, ad hoc « internal » ou store            → production
// Les variantes distribuées (preview ad hoc, beta TestFlight, production)
// sont toujours signées en distribution → production, sans dépendre
// d'EAS_BUILD_PROFILE : selon la commande qui évalue la config, il peut manquer
// hors builder, et l'empreinte doit rester identique partout. Pour
// development, EAS_BUILD_PROFILE est posé par EAS Build ; son absence signifie
// qu'on est en build local signé avec un profil de développement.
const DEV_CLIENT_BUILD_PROFILES = new Set([
  "development-ios-device",
  "development-ios-simulator",
  "development-android",
]);
const EAS_BUILD_PROFILE = process.env.EAS_BUILD_PROFILE;
const APS_ENVIRONMENT =
  !FIREBASE_REQUIRED &&
  (EAS_BUILD_PROFILE === undefined ||
    DEV_CLIENT_BUILD_PROFILES.has(EAS_BUILD_PROFILE))
    ? "development"
    : "production";

if (!FIREBASE_ENABLED) {
  console.warn(
    `[app.config] Pas de config Firebase pour "${APP_ENV}" (${BUNDLE_ID}) : ` +
      "les notifications push seront inactives sur cette variante. Déposez " +
      `${FIREBASE_FILES.ios.variant} (iOS) et/ou ${FIREBASE_FILES.android.variant} ` +
      "(Android) — voir apps/client/firebase/README.md.",
  );
} else if (process.env.EAS_BUILD === "true" || !FIREBASE_REQUIRED) {
  // Hors builder, un fichier manquant pour une variante distribuée est la
  // norme (le secret n'existe que sur le builder) : on ne prévient que là où
  // il compte, ou pour development avec une seule plateforme configurée.
  // Sur le builder, EAS_BUILD_PLATFORM désigne la seule plateforme construite :
  // un build iOS n'a que faire du json Android (et inversement). N'influe que
  // sur ce message, jamais sur la config évaluée (donc pas sur l'empreinte).
  const EAS_BUILD_PLATFORM = process.env.EAS_BUILD_PLATFORM;
  const builtPlatforms =
    EAS_BUILD_PLATFORM === "ios" || EAS_BUILD_PLATFORM === "android"
      ? [EAS_BUILD_PLATFORM]
      : ["ios", "android"];
  const missing = builtPlatforms
    .filter((platform) => !resolveFirebaseFile(platform))
    .map((platform) => FIREBASE_FILES[platform]);
  if (missing.length > 0) {
    console.warn(
      `[app.config] Config Firebase manquante pour "${APP_ENV}" : ` +
        missing.map((f) => `${f.variant} (ou env ${f.envVar})`).join(", ") +
        ". Les plugins Firebase sont actifs, donc le prebuild de cette " +
        "plateforme échouera tant que le fichier n'est pas fourni.",
    );
  }
}

module.exports = {
  expo: {
    name: APP_NAME,
    slug: "ffd-connect",
    scheme: "ffdconnect",
    // Version marketing (TestFlight / App Store), bumpée par release-please.
    version: "1.0.0", // x-release-please-version
    orientation: "portrait",
    icon: APP_ICON,
    userInterfaceStyle: "automatic",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    assetBundlePatterns: ["**/*"],
    // EAS Update (OTA) : une OTA n'atteint que les binaires de même
    // runtimeVersion. `fingerprint` la calcule à partir de tout ce qui façonne
    // le binaire (modules natifs, plugins, config) : elle change d'elle-même
    // quand un build natif devient nécessaire, plus de bump manuel à décider.
    // Les numéros de version sont exclus du calcul (fingerprint.config.js).
    // Piège : l'empreinte dépend d'EXPO_PUBLIC_APP_ENV (bundle id, icône). Une
    // OTA calculée avec la mauvaise variante n'atteint aucun appareil, sans
    // erreur — d'où scripts/check-ota-reach.sh après chaque `eas update` en CI.
    runtimeVersion: { policy: "fingerprint" },
    updates: {
      url: "https://u.expo.dev/1138b975-113e-4fac-a7c8-f82fd5eef296",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: BUNDLE_ID,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        // Explicit Face ID usage description. Without it, iOS reports Face ID
        // as unavailable to the app (canEvaluatePolicy → false, "biometryNotAvailable")
        // even though the hardware is present and enrolled — which is exactly
        // what the on-device diagnostic showed (hasHardware=false, types=[2]).
        // The expo-local-authentication plugin is supposed to inject this; set it
        // here too so it's guaranteed in the built Info.plist.
        NSFaceIDUsageDescription:
          "FFD Connect utilise Face ID pour sécuriser l'accès à votre compte.",
        // Requis par @react-native-firebase/messaging pour que
        // setBackgroundMessageHandler reçoive les messages data-only quand
        // l'app est en arrière-plan (NotificationHandler en enregistre un).
        // Sans ce mode, iOS jette silencieusement ces messages.
        // Seulement quand Firebase est réellement actif : déclarer un mode
        // d'arrière-plan inutilisé est du bruit en revue App Store. expo-audio
        // ajoute "audio" par-dessus via withInfoPlist (push, pas remplacement),
        // donc la lecture en arrière-plan n'est pas affectée.
        ...(FIREBASE_ENABLED
          ? { UIBackgroundModes: ["remote-notification"] }
          : {}),
      },
      // Config Firebase iOS de la variante courante (résolue par
      // resolveFirebaseFile : env EAS > firebase/<env>), posée seulement si le
      // fichier existe (cf. FIREBASE_IOS_FILE). Variante distribuée sans
      // fichier : plugins actifs, le prebuild échoue ; development sans
      // fichier : plugins Firebase désactivés.
      ...(FIREBASE_IOS_FILE ? { googleServicesFile: FIREBASE_IOS_FILE } : {}),
      // Gaté sur FIREBASE_ENABLED comme UIBackgroundModes : déclarer
      // aps-environment sans Firebase exigerait la capability Push
      // Notifications sur le profil de provisioning pour rien.
      ...(FIREBASE_ENABLED
        ? { entitlements: { "aps-environment": APS_ENVIRONMENT } }
        : {}),
      // jsEngine moved to expo-build-properties below (root-level setting was
      // ignored on Expo SDK 55+; Hermes was still being bundled and crashing
      // on iOS 26.3.1).
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#014689",
      },
      package: BUNDLE_ID,
      versionCode: 1,
      // Config Firebase Android de la variante courante (même résolution).
      ...(FIREBASE_ANDROID_FILE
        ? { googleServicesFile: FIREBASE_ANDROID_FILE }
        : {}),
    },
    web: {
      favicon: "./assets/favicon.png",
      bundler: "metro",
    },
    plugins: [
      // Stockage sécurisé (Keychain iOS / Keystore Android) pour les tokens auth.
      "expo-secure-store",
      // Expo build properties (intégration native avancée: Firebase, frameworks, etc.)
      [
        "expo-build-properties",
        {
          ios: {
            // SDK 57 / expo-build-properties requires >= 16.4 (was 16.0 on SDK 55).
            deploymentTarget: "16.4",
            // #437 TEST — re-enabling Hermes on SDK 57 / RN 0.86. The boot crash
            // ("throwPendingError" + "_objc_terminate", NSException) was NOT a
            // Hermes bug but an ObjCTurboModule NSException-handling bug on iOS 26
            // (expo/expo#44606, facebook/react-native#54859), fixed upstream around
            // RN 0.84.1/0.85. RN 0.86 should include it. MUST be device-tested on
            // iOS 26 before merging to develop. Revert to "jsc" if it crashes.
            jsEngine: "hermes",
          },
          android: { minSdkVersion: 24 },
        },
      ],
      // use_modular_headers! pour Firebase/GoogleUtilities (EAS + prebuild)
      // Keep enabled even when Firebase plugin is off — Sentry/Firebase
      // packages are still in package.json so autolinking pulls their pods,
      // which need modular headers on GoogleUtilities.
      "./plugins/withModularHeaders.js",
      // Audio engine (New-Architecture native, replaces react-native-track-player
      // which is old-arch and produced no sound under SDK 57 New Arch).
      "expo-audio",
      // NOTE: withFaceIDiOS26Fix removed — the on-device diagnostic proved there
      // is NO NSException/crash (hasHardware/isEnrolled return false without
      // throwing). The native "catch the exception" patch was solving a
      // non-problem. The real cause is a missing/ineffective NSFaceIDUsageDescription
      // (canEvaluatePolicy → biometryNotAvailable), now set explicitly in
      // ios.infoPlist above.
      // Barre native clavier iOS (^ v ✓) - IQKeyboardManager
      // DISABLED on SDK 57 / RN 0.86: react-native-keyboard-manager's native
      // category on RCTBaseTextInputView (setDefaultInputAccessoryView_backup)
      // no longer compiles against the reorganized RN 0.86 headers
      // (XCODE_BUILD_ERROR: "cannot find interface declaration for
      // 'RCTBaseTextInputView'"). Removed the pod plugin + npm dep to unblock
      // the build; the native keyboard toolbar is gone until a RN-0.86-compatible
      // keyboard manager is wired up.
      // "./plugins/withKeyboardManager.js",
      // Firebase - App & Messaging (notifications push). RE-ENABLED.
      // These were switched off on a mere SUSPICION while bisecting the
      // iOS 26.3.1 SIGABRT (Messaging swizzles UIApplicationDelegate's APNs
      // handlers, so it looked like a plausible culprit). The real cause was
      // elsewhere: an NSException-handling bug in ObjCTurboModule on iOS 26
      // (expo/expo#44606, facebook/react-native#54859, fixed upstream in
      // RN 0.84.1/0.85 and shipped in RN 0.86), plus a missing
      // NSFaceIDUsageDescription — now set explicitly in ios.infoPlist above.
      // Firebase was never re-enabled after that, so push has been dead since.
      // Always loaded for the distributed variants (preview, beta, production)
      // so the native fingerprint does not depend on whether the EAS file
      // secret is present (see FIREBASE_REQUIRED). For development, loaded only
      // when a config file exists: the @react-native-firebase/app plugin throws
      // during prebuild when googleServicesFile is missing.
      ...(FIREBASE_ENABLED
        ? [
            "@react-native-firebase/app",
            "@react-native-firebase/messaging",
            // Seeds `isHeadless` in the root's initial props so a data-only
            // push that launches the app in the background does not mount the
            // whole React tree (#40). Must stay inside this branch: it emits a
            // reference to RNFBMessaging, which a Firebase-less build lacks.
            "./plugins/withFirebaseHeadlessLaunch.js",
          ]
        : []),
      // Sentry - crash reports & stack traces (SENTRY_AUTH_TOKEN dans EAS pour l'upload)
      [
        "@sentry/react-native/expo",
        {
          url: process.env.SENTRY_URL || "https://de.sentry.io/",
          organization: process.env.SENTRY_ORG || "gabin-simond",
          project: process.env.SENTRY_PROJECT || "ffd-client",
        },
      ],
      // --- Modules réservés au mobile (voir MODULES_MOBILE_ONLY.md) ---
      // Expo Camera - Scan QR des licences (fallback web : ScannerScreen.web.tsx)
      [
        "expo-camera",
        {
          cameraPermission:
            "FFD Connect utilise la caméra pour scanner les licences.",
        },
      ],
      // Track Player - Lecteur audio (fallback web : PlayerContext.web.tsx)
      // Note: Temporarily disabled in plugins to avoid ESM import issues in Node.js context
      // The module will still work on native platforms via manual registration in index.js
      // 'react-native-track-player',
      // Biometrics - Use Expo alternative
      [
        "expo-local-authentication",
        {
          faceIDPermission:
            "$(PRODUCT_NAME) needs access to Face ID to authenticate.",
        },
      ],
      // Image Picker - Use Expo alternative
      [
        "expo-image-picker",
        {
          photosPermission:
            "$(PRODUCT_NAME) needs access to your photos to select images.",
          cameraPermission:
            "$(PRODUCT_NAME) needs access to your camera to take photos.",
        },
      ],
      // Location - distance display on competition cards
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "$(PRODUCT_NAME) utilise votre position pour afficher la distance aux compétitions.",
          locationWhenInUsePermission:
            "$(PRODUCT_NAME) utilise votre position pour afficher la distance aux compétitions.",
        },
      ],
      // Calendar - add competition to calendar
      [
        "expo-calendar",
        {
          calendarPermission:
            "$(PRODUCT_NAME) peut ajouter des compétitions à votre calendrier.",
        },
      ],
      // Notifications - local reminders for registration deadlines
      // TEMPORARILY DISABLED for iOS 26.3.1 SIGABRT investigation (same as
      // Firebase Messaging — APNs swizzle suspect).
      // [
      //   "expo-notifications",
      //   {
      //     icon: "./assets/notification-icon.png",
      //     color: "#004481",
      //   },
      // ],
      // File System - Use Expo alternative
      "expo-file-system",
      // Sharing - Use Expo alternative
      // Note: Temporarily disabled - expo-sharing plugin has issues with expo-modules-core
      // The module will still work via direct imports in code
      // 'expo-sharing',
      // Device Info - Use Expo alternative
      // Note: Temporarily disabled - expo-device plugin has issues with expo-modules-core
      // The module will still work via direct imports in code
      // 'expo-device',
      // AV (Audio/Video) - Removed, use direct imports if needed
      // 'expo-av',
    ],
    // Privacy policy: set in Google Play Console (Policy → App content → Privacy policy).
    // Required when the app uses sensitive permissions (camera, microphone, etc.).
    extra: {
      eas: {
        projectId: "1138b975-113e-4fac-a7c8-f82fd5eef296",
      },
    },
  },
};
