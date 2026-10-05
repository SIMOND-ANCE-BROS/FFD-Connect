# Test : Peut-on éviter les patches ?

## 🧪 Test 1 : Désactiver `unstable_enablePackageExports`

### Modifier `metro.config.js` :

```js
resolver: {
  ...defaultConfig.resolver,
  resolveRequest,
  nodeModulesPaths: [
    path.resolve(__dirname, 'node_modules'),
    path.resolve(root, 'node_modules'),
  ],
  unstable_enableSymlinks: true,
  unstable_enablePackageExports: false, // ← Changer à false
  // ...
}
```

### Tester :

```bash
# Supprimer les patches
rm -rf node_modules apps/*/node_modules
pnpm install --no-postinstall  # Installer sans appliquer les patches

# Tester le démarrage
cd apps/client
pnpm start
```

**Résultat attendu :**

- ✅ Peut résoudre les problèmes Metro/expo-modules-core
- ⚠️ Peut causer d'autres problèmes avec des packages qui dépendent des exports
- ⚠️ Solution temporaire (sera déprécié)

---

## 🧪 Test 2 : Utiliser `public-hoist-pattern` pour @babel/runtime

### Modifier `.npmrc` :

```ini
node-linker=hoisted
symlink=false
public-hoist-pattern[]=*@babel/runtime*
```

### Supprimer la copie de @babel/runtime

Dans `scripts/patch-metro-cache.cjs`, commenter la fonction `linkBabelRuntime()`.

### Tester :

```bash
rm -rf node_modules apps/*/node_modules
pnpm install
cd apps/client
pnpm start
```

**Résultat attendu :**

- ✅ Peut résoudre le problème @babel/runtime
- ⚠️ Peut ne pas fonctionner selon la version de pnpm

---

## 🧪 Test 3 : Combinaison des deux

1. Désactiver `unstable_enablePackageExports`
2. Utiliser `public-hoist-pattern` pour @babel/runtime
3. Garder uniquement les patches pour :
   - expo-modules-core (si nécessaire)
   - expo-sharing/expo-device (si nécessaire)
   - freeport-async (si nécessaire)

---

## 📊 Résultats attendus

| Test   | Patches nécessaires | Risques                       |
| ------ | ------------------- | ----------------------------- |
| Test 1 | Réduits (Metro OK)  | Peut casser d'autres packages |
| Test 2 | Réduits (@babel OK) | Peut ne pas fonctionner       |
| Test 3 | Minimaux            | Solution hybride              |

---

## ⚠️ Attention

Ces tests peuvent casser le projet. Faire les tests dans une branche séparée :

```bash
git checkout -b test/sans-patches-metro
# Faire les modifications
# Tester
# Si ça ne marche pas, revenir à la branche principale
```
