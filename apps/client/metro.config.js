const path = require("path");
const fs = require("fs");
const { getDefaultConfig } = require("expo/metro-config");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const {
  getRewriteRequestUrl,
} = require("@expo/metro-config/build/rewriteRequestUrl");

/**
 * Metro configuration avec Expo.
 * Depuis SDK 52+, Expo configure automatiquement watchFolders et nodeModulesPaths.
 * Les patches dans patches/ (pnpm patch) résolvent les problèmes
 * d'exports pour metro, metro-cache et metro-transform-worker.
 */
const root = path.resolve(__dirname, "../..");
const babelRuntimeRoot = path.resolve(
  root,
  "node_modules",
  "@babel",
  "runtime",
);

const expoConfig = getDefaultConfig(__dirname);
const sentryConfig = getSentryExpoConfig(__dirname);
const defaultConfig = { ...expoConfig, ...sentryConfig };

const projectRoot = __dirname;

/**
 * Réécriture d'URL : index.bundle?platform=web -> .expo/.virtual-metro-entry.bundle?platform=web
 * Force Expo à utiliser resolveEntryPoint (qui retourne index.web.js pour le web).
 */
function customRewriteRequestUrl(url) {
  const originalRewrite = getRewriteRequestUrl(projectRoot);
  // index.bundle pour web -> entrée virtuelle -> index.web.js
  const isIndexBundle =
    url.includes("index.bundle") || url.includes("index.web.bundle");
  const platform = url.includes("platform=")
    ? new URL(url, "https://acme.dev").searchParams.get("platform")
    : null;
  const isWeb = platform === "web" || platform === null;
  if (isIndexBundle && isWeb) {
    const parsed = url.startsWith("/")
      ? new URL(url, "https://acme.dev")
      : new URL(url);
    const params = parsed.searchParams;
    if (!params.has("platform")) params.set("platform", "web");
    // Forcer JSC pour le web : Hermes cause "useState of null" dans le navigateur
    params.delete("transform.engine");
    params.delete("transform.bytecode");
    params.delete("unstable_transformProfile");
    const virtualUrl = `/.expo/.virtual-metro-entry.bundle?${params.toString()}`;
    return originalRewrite(virtualUrl);
  }
  return originalRewrite(url);
}

/**
 * Force @babel/runtime et point d'entrée web.
 */
const MOCKS = {
  "react-native-fs": path.resolve(projectRoot, "src/mocks/RNFS.web.ts"),
  "react-native-track-player": path.resolve(
    projectRoot,
    "src/mocks/TrackPlayer.web.ts",
  ),
  "react-native-linear-gradient": path.resolve(
    projectRoot,
    "src/mocks/LinearGradient.web.tsx",
  ),
  "react-native-sound": path.resolve(projectRoot, "src/mocks/Sound.web.ts"),
  // web uniquement, et surtout PAS dans extraNodeModules plus bas : cette
  // table-là n'est pas filtrée par plateforme et mockerait Firebase sur
  // natif aussi, ce qui tuerait les push en silence (cf. #534).
  "@react-native-firebase/messaging": path.resolve(
    projectRoot,
    "src/mocks/FirebaseMessaging.web.ts",
  ),
  "react-native-biometrics": path.resolve(
    projectRoot,
    "src/mocks/Biometrics.web.ts",
  ),
  "expo-device": path.resolve(projectRoot, "src/mocks/ExpoDevice.web.ts"),
  "expo-sharing": path.resolve(projectRoot, "src/mocks/ExpoSharing.web.ts"),
  "merge-options": path.resolve(projectRoot, "src/mocks/merge-options.js"),
  "@react-native-community/blur": path.resolve(
    projectRoot,
    "src/mocks/BlurView.web.tsx",
  ),
};

function resolveRequest(context, moduleName, platform) {
  if (platform === "web" && MOCKS[moduleName]) {
    return { type: "sourceFile", filePath: MOCKS[moduleName] };
  }

  // MONOREPO: expo/AppEntry.js est hoisted à la racine, son "../../App" pointe hors du projet.
  // On le redirige vers apps/client/App.tsx pour iOS/Android.
  if (platform !== "web") {
    const appNative = path.join(projectRoot, "App.tsx");
    const matchesAppFromRoot =
      moduleName === "../../App" ||
      (path.isAbsolute(moduleName) && moduleName === path.join(root, "App"));
    if (matchesAppFromRoot && fs.existsSync(appNative)) {
      return { type: "sourceFile", filePath: appNative };
    }
  }

  // WEB: forcer App -> App.web et index -> index.web.js
  if (platform === "web") {
    const appWeb = path.join(projectRoot, "App.web.tsx");
    const indexWebJs = path.join(projectRoot, "index.web.js");
    const matchesApp =
      moduleName === "./App" ||
      moduleName === "App" ||
      moduleName.endsWith("/App");
    const matchesIndex =
      moduleName === "index" ||
      moduleName === "./index" ||
      moduleName === "./index.js" ||
      (path.isAbsolute(moduleName) &&
        moduleName.endsWith("index.js") &&
        !moduleName.endsWith("index.web.js"));

    if (matchesApp && fs.existsSync(appWeb)) {
      return { type: "sourceFile", filePath: appWeb };
    }
    if (matchesIndex && fs.existsSync(indexWebJs)) {
      return { type: "sourceFile", filePath: indexWebJs };
    }
  }

  // react-native-screens: force compiled output to avoid codegen incompatibilities with RN 0.83.2
  // The package.json "react-native" field points to src/index which loads src/fabric/*.ts files
  // that use TypeScript types unsupported by RN 0.83.2's babel-plugin-codegen.

  // Force react-native-reanimated resolution (Metro sometimes fails to resolve src/index.ts)
  // Prefer source so Babel plugins (reanimated/plugin) run; fallback to pre-built lib
  if (moduleName === "react-native-reanimated") {
    const reanimatedSrc = path.resolve(
      projectRoot,
      "node_modules/react-native-reanimated/src/index.ts",
    );
    const reanimatedLib = path.resolve(
      projectRoot,
      "node_modules/react-native-reanimated/lib/module/index.js",
    );
    if (fs.existsSync(reanimatedSrc)) {
      return { type: "sourceFile", filePath: reanimatedSrc };
    }
    if (fs.existsSync(reanimatedLib)) {
      return { type: "sourceFile", filePath: reanimatedLib };
    }
  }

  if (moduleName.startsWith("@babel/runtime")) {
    const subpath = moduleName.replace("@babel/runtime", "") || "/";
    const fullPath = path.join(babelRuntimeRoot, subpath.replace(/^\//, ""));
    const withJs = fullPath.endsWith(".js") ? fullPath : `${fullPath}.js`;
    if (fs.existsSync(withJs)) {
      return { type: "sourceFile", filePath: withJs };
    }
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        return { type: "sourceFile", filePath: fullPath };
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
}

const config = {
  ...defaultConfig,
  serializer: {
    ...defaultConfig.serializer,
    // Inject metro-polyfill.js BEFORE any __r() entry point. This runs before
    // InitializeCore (which loads ReactFabric and captures supportsUserTiming
    // based on console.timeStamp existence). Module-level polyfills via
    // index.js are too late.
    getPolyfills: (...args) => [
      ...(defaultConfig.serializer?.getPolyfills?.(...args) ?? []),
      path.resolve(projectRoot, "metro-polyfill.js"),
    ],
  },
  server: {
    ...defaultConfig.server,
    rewriteRequestUrl: customRewriteRequestUrl,
  },
  resolver: {
    ...defaultConfig.resolver,
    resolveRequest,
    unstable_enablePackageExports: true,
    extraNodeModules: {
      ...defaultConfig.resolver?.extraNodeModules,
      react: path.resolve(root, "node_modules/react"),
      "react-dom": path.resolve(root, "node_modules/react-dom"),
      "@babel/runtime": babelRuntimeRoot,
      "react-native-fs": path.resolve(projectRoot, "src/mocks/RNFS.web.ts"),
      "react-native-track-player": path.resolve(
        projectRoot,
        "src/mocks/TrackPlayer.web.ts",
      ),
      "react-native-sound": path.resolve(projectRoot, "src/mocks/Sound.web.ts"),
      "react-native-biometrics": path.resolve(
        projectRoot,
        "src/mocks/Biometrics.web.ts",
      ),
      "merge-options": path.resolve(projectRoot, "src/mocks/merge-options.js"),
      "@react-native-community/blur": path.resolve(
        projectRoot,
        "src/mocks/BlurView.web.tsx",
      ),
      "react-native-linear-gradient": path.resolve(
        projectRoot,
        "src/mocks/LinearGradient.web.tsx",
      ),
      // NOTE: expo-device / expo-sharing sont
      // INSTALLÉS et ne doivent PAS être aliasés ici — extraNodeModules écrase
      // le vrai paquet sur TOUTES les plateformes (natif inclus), ce qui servait
      // le mock web sur iPhone (« Système : iOS Web », export RGPD sans partage,
      // scanner no-op). Le web reste couvert par resolveRequest (MOCKS, gated
      // sur platform === "web"). Les entrées ci-dessus restent car leurs paquets
      // sont désinstallés (legacy) : le mock est alors un fallback nécessaire.
    },
  },
};

module.exports = config;
