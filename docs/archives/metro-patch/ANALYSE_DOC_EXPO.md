# Analyse selon la documentation Expo Monorepos

Référence : [Expo Monorepos Guide](https://docs.expo.dev/guides/monorepos/)

## 📋 Points clés de la documentation

### 1. Configuration automatique (SDK 52+)

**Tu utilises Expo SDK 54** ✅, donc Expo devrait configurer Metro automatiquement.

Selon la doc, depuis SDK 52+, tu **peux supprimer** ces configurations manuelles :

- `watchFolders`
- `resolver.nodeModulesPath` (ou `nodeModulesPaths`)
- `resolver.extraNodeModules` (sauf si nécessaire pour des cas spécifiques)
- `resolver.disableHierarchicalLookup`

### 2. Configuration actuelle de ton projet

Dans `metro.config.js`, tu as encore :

```js
watchFolders: [root],  // ← Peut être supprimé selon la doc
nodeModulesPaths: [    // ← Peut être supprimé selon la doc
  path.resolve(__dirname, 'node_modules'),
  path.resolve(root, 'node_modules'),
],
extraNodeModules: {    // ← Partiellement nécessaire pour tes mocks
  // ...
}
```

### 3. Ce qui reste nécessaire

**Tu DOIS garder** :

- `extraNodeModules` pour tes **mocks web** (expo-device, expo-sharing, etc.)
- `resolveRequest` pour la résolution personnalisée (mocks, @babel/runtime, react-native-reanimated)
- `rewriteRequestUrl` pour le support web
- `unstable_enablePackageExports: true` (si nécessaire)

**Tu PEUX supprimer** (selon la doc) :

- `watchFolders` - Expo le configure automatiquement
- `nodeModulesPaths` - Expo le configure automatiquement
- Certaines entrées dans `extraNodeModules` qui sont déjà gérées automatiquement

---

## 🔍 Pourquoi les patches sont-ils encore nécessaires ?

### Patches nécessaires MALGRÉ la doc :

1. **Metro exports internes** (`metro`, `metro-cache`, `metro-transform-worker`)
   - ❌ **Pas mentionné dans la doc Expo**
   - Problème : Metro 0.83+ avec exports stricts
   - Expo CLI accède aux internes non exportés
   - **Solution :** Patch nécessaire (bug connu Metro/Expo)

2. **expo-modules-core** (fichier TypeScript)
   - ❌ **Pas mentionné dans la doc**
   - Problème : Package pointe vers `.ts` au lieu de `.js`
   - **Solution :** Patch nécessaire (bug du package)

3. **expo-sharing / expo-device** (imports ESM)
   - ❌ **Pas mentionné dans la doc**
   - Problème : Imports sans extensions `.js`
   - **Solution :** Patch nécessaire (bug des packages)

4. **freeport-async** (dépassement de port)
   - ❌ **Pas mentionné dans la doc**
   - Problème : Peut dépasser le port 65535
   - **Solution :** Patch nécessaire (bug du package)

5. **@babel/runtime** (résolution monorepo)
   - ⚠️ **Partiellement mentionné dans la doc**
   - La doc mentionne que pnpm avec `node-linker=hoisted` devrait fonctionner
   - Mais tu as encore besoin de copier @babel/runtime
   - **Solution :** Peut-être améliorable avec `public-hoist-pattern`

### Ce que la doc dit sur les patches :

> "All Expo SDK modules and templates have these dynamic references and work with monorepos. However, occasionally, you might run into packages that still use the hardcoded path. You can manually edit it with [`patch-package`](https://github.com/ds300/patch-package#readme) or mention this to the package maintainers."

**Conclusion :** La doc reconnaît que certains packages peuvent nécessiter `patch-package`, mais ne mentionne pas spécifiquement les problèmes que tu rencontres.

---

## ✅ Recommandations selon la doc

### 1. Simplifier `metro.config.js`

Tu peux essayer de supprimer `watchFolders` et `nodeModulesPaths` :

```js
const config = {
  ...defaultConfig,
  // watchFolders: [root],  // ← Supprimer (automatique avec SDK 54)
  server: {
    ...defaultConfig.server,
    rewriteRequestUrl: customRewriteRequestUrl,
  },
  resolver: {
    ...defaultConfig.resolver,
    resolveRequest,
    // nodeModulesPaths: [...]  // ← Supprimer (automatique avec SDK 54)
    unstable_enableSymlinks: true,
    unstable_enablePackageExports: true,
    extraNodeModules: {
      // Garder uniquement ce qui est nécessaire pour tes mocks
      '@babel/runtime': babelRuntimeRoot,
      // ... tes mocks web
    },
  },
};
```

### 2. Tester sans certaines configurations

**Test 1 :** Supprimer `watchFolders` et `nodeModulesPaths`

```bash
# Dans une branche de test
git checkout -b test/simplify-metro-config

# Modifier metro.config.js (supprimer watchFolders et nodeModulesPaths)
# Tester
cd apps/client
pnpm start --clear
```

**Test 2 :** Utiliser `public-hoist-pattern` pour @babel/runtime

Dans `.npmrc` :

```ini
node-linker=hoisted
symlink=false
public-hoist-pattern[]=*@babel/runtime*
```

Puis supprimer la copie manuelle de @babel/runtime.

### 3. Garder les patches

Même avec la configuration simplifiée, **les patches restent nécessaires** car :

- Ce sont des bugs dans les packages (Metro, Expo)
- Pas de solution officielle dans la doc Expo
- La doc mentionne `patch-package` comme solution acceptable

---

## 📊 Résumé

| Élément               | Doc Expo dit                          | Ton cas                   | Action                           |
| --------------------- | ------------------------------------- | ------------------------- | -------------------------------- |
| `watchFolders`        | Auto (SDK 52+)                        | Configuré manuellement    | ✅ Peut supprimer                |
| `nodeModulesPaths`    | Auto (SDK 52+)                        | Configuré manuellement    | ✅ Peut supprimer                |
| `extraNodeModules`    | Auto (SDK 52+)                        | Utilisé pour mocks        | ⚠️ Garder pour mocks             |
| Patches Metro         | Non mentionné                         | Nécessaire                | ✅ Garder (bug connu)            |
| Patches Expo packages | Mentionné comme possible              | Nécessaire                | ✅ Garder (bug packages)         |
| @babel/runtime        | `node-linker=hoisted` devrait suffire | Copie manuelle nécessaire | ⚠️ Tester `public-hoist-pattern` |

---

## 🎯 Prochaines étapes

1. **Simplifier `metro.config.js`** selon la doc (supprimer watchFolders/nodeModulesPaths)
2. **Tester `public-hoist-pattern`** pour @babel/runtime
3. **Garder les patches** (nécessaires malgré la doc)
4. **Migrer vers `patch-package`** pour une meilleure maintenabilité
