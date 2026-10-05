# Alternatives au patch Metro

## Option 1 : patch-package (✅ RECOMMANDÉ)

Voir `MIGRATION_PATCH_PACKAGE.md` pour les détails.

**Avantages :**

- Patches versionnés dans Git
- Application automatique
- Détecte les conflits de version
- Standard de l'industrie

**Inconvénients :**

- Nécessite de recréer les patches lors des mises à jour majeures

---

## Option 2 : Utiliser pnpm hoisting pour @babel/runtime

Modifier `.npmrc` pour hoister @babel/runtime :

```ini
# .npmrc
node-linker=hoisted
symlink=false
public-hoist-pattern[]=*@babel/runtime*
```

Et dans `metro.config.js`, s'assurer que la résolution pointe vers le bon endroit (déjà fait).

**Avantages :**

- Plus simple
- Pas besoin de copier @babel/runtime

**Inconvénients :**

- Ne résout pas les problèmes d'exports Metro
- Peut causer des problèmes avec d'autres packages

---

## Option 3 : Utiliser un resolver personnalisé dans metro.config.js

Pour certains problèmes d'exports, on peut utiliser `unstable_enablePackageExports: false` :

```js
// metro.config.js
resolver: {
  unstable_enablePackageExports: false, // Désactive les exports stricts
  // ...
}
```

**Avantages :**

- Pas de patch nécessaire
- Solution au niveau Metro

**Inconvénients :**

- ⚠️ Peut casser d'autres packages qui dépendent des exports
- Ne résout pas tous les problèmes (expo-modules-core, freeport-async, etc.)

---

## Option 4 : Utiliser pnpm overrides avec des packages forkés

Créer des forks des packages problématiques et les publier sous un scope privé.

**Avantages :**

- Contrôle total
- Pas de patches

**Inconvénients :**

- Maintenance lourde
- Nécessite de maintenir des forks
- Overkill pour ce cas d'usage

---

## Option 5 : Attendre que les packages soient corrigés

Suivre les issues GitHub :

- [Metro exports](https://github.com/facebook/metro/issues)
- [Expo compatibility](https://github.com/expo/expo/issues)

**Avantages :**

- Solution définitive à long terme

**Inconvénients :**

- Pas de solution immédiate
- Peut prendre des mois/années

---

## Recommandation finale

**Utiliser Option 1 (patch-package)** car :

1. C'est la solution la plus robuste et maintenable
2. Les patches sont versionnés et trackés
3. Compatible avec CI/CD
4. Standard dans l'écosystème React Native/Expo

Pour @babel/runtime, on peut combiner avec Option 2 (hoisting) si le hoisting fonctionne bien, sinon garder le script de copie.
