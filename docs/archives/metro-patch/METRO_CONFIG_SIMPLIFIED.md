# Simplification de metro.config.js selon la doc Expo

## 🔍 Observation importante

Tu utilises `getSentryExpoConfig` au lieu de `getDefaultConfig` d'Expo. Cela pourrait affecter la configuration automatique du monorepo.

## 📝 Configuration simplifiée (selon la doc Expo)

Selon la [documentation Expo Monorepos](https://docs.expo.dev/guides/monorepos/), avec SDK 54, tu peux simplifier ta config.

### Version actuelle (avec configurations manuelles)

```js
const config = {
  ...defaultConfig,
  watchFolders: [root], // ← Peut être supprimé
  resolver: {
    ...defaultConfig.resolver,
    nodeModulesPaths: [
      // ← Peut être supprimé
      path.resolve(__dirname, 'node_modules'),
      path.resolve(root, 'node_modules'),
    ],
    // ...
  },
};
```

### Version simplifiée (selon la doc)

```js
const { getDefaultConfig } = require('expo/metro-config');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// Utiliser getDefaultConfig d'Expo pour la config automatique monorepo
const expoConfig = getDefaultConfig(__dirname);
const sentryConfig = getSentryExpoConfig(__dirname);

// Fusionner les configs (Sentry peut override certaines valeurs)
const defaultConfig = {
  ...expoConfig,
  ...sentryConfig,
  // Sentry peut avoir des valeurs spécifiques à préserver
};

const config = {
  ...defaultConfig,
  // watchFolders supprimé - Expo le configure automatiquement
  server: {
    ...defaultConfig.server,
    rewriteRequestUrl: customRewriteRequestUrl,
  },
  resolver: {
    ...defaultConfig.resolver,
    resolveRequest,
    // nodeModulesPaths supprimé - Expo le configure automatiquement
    unstable_enableSymlinks: true,
    unstable_enablePackageExports: true,
    extraNodeModules: {
      // Garder uniquement ce qui est nécessaire pour tes mocks personnalisés
      '@babel/runtime': babelRuntimeRoot,
      // ... tes mocks web
    },
  },
};
```

---

## ⚠️ Attention : getSentryExpoConfig

`getSentryExpoConfig` pourrait ne pas inclure la configuration automatique du monorepo d'Expo.

**Options :**

1. **Utiliser `getDefaultConfig` d'Expo puis appliquer Sentry** :

```js
const { getDefaultConfig } = require('expo/metro-config');
const { mergeConfig } = require('@expo/metro-config');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const expoConfig = getDefaultConfig(__dirname); // ← Config monorepo automatique
const sentryConfig = getSentryExpoConfig(__dirname);

const defaultConfig = mergeConfig(expoConfig, sentryConfig);
```

2. **Vérifier si Sentry préserve la config monorepo** :
   - Tester si `getSentryExpoConfig` inclut déjà `watchFolders` et `nodeModulesPaths`
   - Si oui, tu peux les supprimer
   - Si non, il faut les garder

---

## 🧪 Test recommandé

1. Créer une branche de test
2. Modifier `metro.config.js` pour utiliser `getDefaultConfig` d'Expo
3. Supprimer `watchFolders` et `nodeModulesPaths`
4. Tester avec `pnpm start --clear`

Si ça fonctionne, tu auras simplifié la config selon la doc Expo.
