# Pourquoi patcher Metro ? Est-ce normal ?

## 🎯 Réponse courte

**Non, ce n'est PAS un comportement "classique"** pour un projet Expo standard. Les patches sont nécessaires à cause de :

1. **Monorepo pnpm** (configuration spécifique)
2. **Incompatibilités temporaires** entre Metro 0.83+ et Expo SDK 54
3. **Bugs connus** dans certains packages Expo

## 📋 Détail des problèmes

### 1. Metro 0.83+ avec exports stricts

**Problème :**

- Metro 0.83+ utilise le champ `exports` dans `package.json` de manière stricte
- Expo CLI accède encore à des chemins internes de Metro qui ne sont pas exportés publiquement
- Exemple : `metro/src/DeltaBundler/Serializers/sourceMapString.js`

**Est-ce normal ?**

- ❌ Non, c'est un problème de transition
- Expo devrait migrer vers les APIs publiques de Metro
- Problème connu : [facebook/metro#1278](https://github.com/facebook/metro/issues/1278)

**Solution actuelle :**

- Patch les `package.json` de Metro pour exposer les chemins internes nécessaires
- **Alternative possible :** Attendre qu'Expo migre (peut prendre des mois)

---

### 2. Monorepo pnpm avec hoisting

**Problème :**

- `@babel/runtime` n'est pas résolu correctement depuis `node_modules` à la racine
- Metro cherche dans `apps/client/node_modules` mais trouve dans `node_modules` (racine)

**Est-ce normal ?**

- ⚠️ Partiellement normal pour pnpm en monorepo
- pnpm utilise une structure de dépendances différente (hard links, pas de flattening)
- Même avec `node-linker=hoisted`, certains packages peuvent avoir des problèmes

**Solution actuelle :**

- Copie `@babel/runtime` dans `apps/client/node_modules`
- **Alternative possible :** Utiliser `public-hoist-pattern[]=*@babel/runtime*` dans `.npmrc`

---

### 3. expo-modules-core avec TypeScript

**Problème :**

- `expo-modules-core` pointe vers un fichier `.ts` dans son `package.json`
- Node.js ne peut pas charger directement du TypeScript

**Est-ce normal ?**

- ❌ Non, c'est un bug dans le package Expo
- Le package devrait exporter un fichier JavaScript compilé

**Solution actuelle :**

- Crée un wrapper JavaScript minimal
- **Alternative possible :** Attendre une correction d'Expo

---

### 4. expo-sharing et expo-device (imports ESM)

**Problème :**

- Ces packages utilisent des imports ESM sans extensions `.js`
- Node.js/Metro nécessite les extensions en mode strict

**Est-ce normal ?**

- ⚠️ C'est un problème de transition vers ESM
- Les packages devraient utiliser des extensions `.js` pour les imports ESM

**Solution actuelle :**

- Patch les fichiers pour ajouter les extensions `.js`
- **Alternative possible :** Attendre une correction d'Expo

---

### 5. freeport-async (dépassement de port)

**Problème :**

- Le package peut essayer d'utiliser des ports > 65535
- Cause une erreur système

**Est-ce normal ?**

- ❌ Non, c'est un bug dans le package
- Le package devrait vérifier la limite

**Solution actuelle :**

- Patch pour ajouter une vérification de limite
- **Alternative possible :** Utiliser un autre package ou attendre une correction

---

## 🔍 Comparaison avec un projet Expo standard

### Projet Expo standard (sans monorepo)

```bash
expo init MyApp
cd MyApp
npm install
expo start  # ✅ Fonctionne sans patch
```

**Pourquoi ça marche ?**

- Pas de problème de résolution de modules (structure plate)
- npm/yarn gère mieux les dépendances qu'un monorepo pnpm
- Pas besoin d'accéder aux internes de Metro (Expo CLI le fait différemment)

### Projet Expo en monorepo pnpm (ton cas)

```bash
# Structure monorepo
packages/
  shared/
apps/
  client/  # Expo app
```

**Pourquoi ça ne marche pas sans patch ?**

- pnpm utilise une structure de dépendances différente
- Metro doit résoudre depuis plusieurs `node_modules` (racine + app)
- Expo CLI accède aux internes de Metro qui ne sont plus exportés

---

## 📊 Est-ce que d'autres projets ont ce problème ?

### Oui, c'est un problème connu :

1. **Issues GitHub Expo :**
   - [expo/expo#26926](https://github.com/expo/expo/issues/26926) - Problème avec `unstable_enablePackageExports` en monorepo
   - Plusieurs issues similaires sur les monorepos pnpm

2. **Solutions communautaires :**
   - Beaucoup de projets utilisent `patch-package` pour Metro
   - Certains désactivent `unstable_enablePackageExports` (risqué)
   - D'autres utilisent npm/yarn au lieu de pnpm

3. **Documentation Expo :**
   - Expo recommande npm/yarn pour les monorepos (pas pnpm officiellement)
   - Support pnpm ajouté récemment mais avec limitations

---

## ✅ Solutions possibles (du plus simple au plus complexe)

### Option 1 : Garder les patches (recommandé pour l'instant)

**Avantages :**

- ✅ Fonctionne maintenant
- ✅ Pas de changement majeur
- ✅ Solution temporaire en attendant les corrections

**Inconvénients :**

- ⚠️ Maintenance nécessaire lors des mises à jour
- ⚠️ Fragile si les packages changent

---

### Option 2 : Migrer vers npm/yarn

**Avantages :**

- ✅ Support officiel Expo
- ✅ Moins de problèmes de résolution
- ✅ Pas besoin de patches (probablement)

**Inconvénients :**

- ❌ Perd les avantages de pnpm (rapidité, économie d'espace)
- ❌ Migration nécessaire
- ❌ Peut ne pas résoudre tous les problèmes

---

### Option 3 : Désactiver `unstable_enablePackageExports`

Dans `metro.config.js` :

```js
resolver: {
  unstable_enablePackageExports: false,
  // ...
}
```

**Avantages :**

- ✅ Plus simple
- ✅ Pas de patches nécessaires (peut-être)

**Inconvénients :**

- ⚠️ Peut casser d'autres packages
- ⚠️ Solution temporaire (sera déprécié)
- ⚠️ Peut ne pas résoudre tous les problèmes

---

### Option 4 : Attendre les corrections

**Avantages :**

- ✅ Solution définitive

**Inconvénients :**

- ❌ Peut prendre des mois/années
- ❌ Bloque le développement

---

## 🎯 Recommandation

**Pour l'instant : Garder les patches mais migrer vers `patch-package`**

1. ✅ Les patches sont nécessaires à cause de la configuration (monorepo pnpm)
2. ✅ Ce n'est pas "normal" mais c'est une solution de contournement temporaire
3. ✅ Utiliser `patch-package` rend les patches plus maintenables
4. ✅ Surveiller les issues Expo pour les corrections futures

**À long terme :**

- Surveiller les mises à jour Expo qui corrigent ces problèmes
- Considérer migrer vers npm/yarn si les problèmes persistent
- Contribuer aux corrections si possible

---

## 📚 Références

- [Expo Monorepo Guide](https://docs.expo.dev/guides/monorepos/)
- [Metro Package Exports Issue](https://github.com/facebook/metro/issues/1278)
- [Expo pnpm Compatibility Issue](https://github.com/expo/expo/issues/26926)
- [pnpm Monorepo Best Practices](https://pnpm.io/workspaces)
