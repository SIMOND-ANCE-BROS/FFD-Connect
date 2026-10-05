---
trigger: always_on
---

**Usage :** À charger lors de la création d'écrans ou de composants.

````markdown
# 📐 Règle Système 1 : Architecture UI & Logique

## 🧱 Pattern View / ViewModel

Séparation stricte entre l'affichage (JSX) et la logique (Hook).

### 1️⃣ UI (Composant .tsx)

- **Rôle :** Purement visuel ("Dumb Component").
- **Responsabilités :**
  - Afficher les données venant du `state`.
  - Lier les interactions utilisateur aux `actions`.
  - Définir les `testID`.
- **Interdictions :**
  - ❌ Aucun `useState`, `useEffect` (sauf animations purement UI).
  - ❌ Aucun calcul métier ou transformation de données complexe.
  - ❌ Aucun appel API direct.

### 2️⃣ Logique (Hook `use[Feature].ts`)

- **Rôle :** Chef d'orchestre de la vue.
- **Retour Obligatoire (Pattern `State/Actions`) :**
  ```typescript
  return {
    state: {
      isLoading,
      data,
      errorMessage,
    },
    actions: {
      onSubmit: handleSubmit,
      onRetry: handleRetry,
    },
  };
  ```
- **Responsabilités :**
  - Gère le State local et les Effets.
  - Appelle les "Service Hooks" pour la donnée.
  - Gère les erreurs (`try/catch`).

### 🟡 Exception

Si le composant est purement décoratif (ex: `<Badge />`, `<Separator />`), le hook n'est pas requis.
````
