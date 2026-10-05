# Analyse approfondie du projet FFD Connect

_Analyse pragmatique — Février 2026_

---

## 1. Avis global

Le projet est **en très bon état** : monorepo clair, backend NestJS modulaire, client Expo structuré par features, sécurité et qualité prises au sérieux. La doc existante ([ANALYSE_PROJET.md](../ANALYSE_PROJET.md), [ARCHITECTURE_PATTERNS.md](./ARCHITECTURE_PATTERNS.md), [error-handling.md](./error-handling.md)) et les actions déjà réalisées (secrets, health, api vs httpInterceptor, couverture, index Prisma) montrent un niveau de maturité au-dessus de la moyenne.

**Conclusion :** Aucun refactoring lourd ni surcouche technique n'est justifié. Les suggestions ci‑dessous sont ciblées et optionnelles.

---

## 2. Ce qui est déjà bien en place

| Domaine             | État                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Architecture**    | Modulaire (NestJS modules, client par features), séparation nette backend / client / shared.                                 |
| **Sécurité**        | JWT + refresh, validation env, pas de log de secrets (vérifié), Helmet, Throttler, CORS.                                     |
| **Résilience**      | Health `/health` (DB + Redis) + `/health/live` pour liveness, retry côté client (api + httpInterceptor).                     |
| **Qualité**         | Couverture backend ~90 %, client 80 % cible, CI avec thresholds, lint, format, audit deps.                                   |
| **Documentation**   | README, ARCHITECTURE_PATTERNS, error-handling, KNOWN_ISSUES, CONTRIBUTING à jour.                                            |
| **Base de données** | Index Prisma cohérents (User, Competition, Event, Registration, etc.), pas d'audit supplémentaire nécessaire pour l'instant. |

---

## 3. api vs httpRequest : pourquoi ce n’est pas unifié

Cette section répond à la question « pourquoi deux mécanismes et quel intérêt de l’un ou l’autre ». Détail complet dans [error-handling.md](./error-handling.md#api-axios-vs-httpinterceptor-fetch).

- **`api` (axios)** : mis en place en premier ; injection du token (AsyncStorage), retry global, gestion 401 (clear token). Utilisé par la majorité des services (Auth, Club, Track, Competitions, etc.).
- **`httpRequest` (fetch)** : ajouté pour un **contrôle explicite** par appel (retry configurable, `errorMessage`, typage `HttpError`), sans dépendance auth. Utilisé notamment par `BackendService` (analyse URL, health).

Unifier (tout migrer ou un seul wrapper) impliquerait un gros refactor ou une couche supplémentaire pour peu de gain. On garde les deux avec une règle claire : **nouveaux appels** → privilégier `httpRequest` si retry + message utilisateur ; **existant** → rester sur `api`, pas de migration systématique.

---

## 4. Couverture client 80 % et tests « triviaux »

### 80 % est-il atteignable sans surtest ?

- **Actuellement** : statements/functions/lines sont proches ou au-dessus de 80 % ; **branches** sont vers 73–74 % (seuil global 80 % en CI).
- **Oui, c’est atteignable** sans surtester en :
  1. **Ciblant des branches utiles** : chemins d’erreur dans `api.ts`, hooks (`useErrorHandler`, `useAsync`), et services (retry, 401, timeouts). Éviter d’ajouter des tests uniquement pour faire monter le chiffre.
  2. **Excluant ce qui n’apporte pas** : les fichiers déjà exclus (types seuls, wrappers natifs, config) sont corrects ; on peut ajouter des exclusions ciblées (ex. écrans très UI/navigation) seulement si ça évite du surtest, pas pour « gonfler » la couverture.

Donc : viser 80 % branches en ajoutant des tests sur les **chemins d’erreur et la logique métier** (validation, retry, auth, erreurs API), pas sur du code trivial ou de l’UI pure.

### Existe-t-il des tests triviaux inutiles ?

- **`Minimal.test.tsx`** : ne fait que rendre `<Text>Hello</Text>` et vérifier que le texte est présent. C’est un **smoke test** pour vérifier que le runner et React Native Testing Library fonctionnent. On peut le garder comme tel ou le supprimer si tu préfères ne pas compter de test « vide ».
- **Autres fichiers parcourus** : pas de tests clairement inutiles. Les tests sur `useLoadingState`, `ThemeContext`, `useErrorHandler`, services (api, auth, club, etc.) couvrent de la logique ou des comportements utiles. Aucune recommandation de suppression.

En résumé : un seul test trivial identifié (Minimal) ; le reste est pertinent. Pour la couverture, privilégier des tests sur les branches critiques plutôt que d’en ajouter sur des détails d’implémentation.

---

## 5. Actions réalisées (suite à l’analyse)

| Action                              | Détail                                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Doc api vs httpRequest**          | [error-handling.md](./error-handling.md) : section réécrite avec « pourquoi deux mécanismes », tableau comparatif (auth, base URL, retry, 401, erreur), règle d’usage et « pas de migration systématique ».             |
| **Test api timeout**                | `apps/client/src/services/__tests__/api.test.ts` : mock de `config` complété avec `API_TIMEOUT_MS`, `API_RETRY_*` pour que le test « has timeout configured » passe.                                                    |
| **Tests LoginScreen / LicenseCard** | `apps/client/jest.setup.js` : mock global de `expo-image` (composant = View) pour éviter les modules natifs ; tous les tests client passent (79 suites, 554 tests).                                                     |
| **Audit dépendances**               | `scripts/audit-dependencies.ts` : normalisation de `pnpm audit --json` (objet → tableau) ; **exit 1 uniquement** si vulnérabilités **high** ou **critical** (dépréciations et outdated ne font plus échouer le script). |
| **CI**                              | `.github/workflows/ci.yml` : suppression de `continue-on-error: true` sur « Run dependency audit » ; la CI échoue si le script détecte des vulnérabilités high/critical.                                                |
| **ANALYSE_APPROFONDIE**             | Ce document : ajout des sections « api vs httpRequest », « Couverture 80 % et tests triviaux », et tableau des actions réalisées.                                                                                       |

---

## 6. Ce qu’il vaut mieux ne pas faire

- **Refactoring massif** : L’architecture actuelle est saine ; pas de grand chambardement sans besoin métier ou technique clair.
- **Sur-outillage** : Pas d’ajout de linters/analyses supplémentaires sans objectif précis ; ESLint, Prettier, Jest, Sentry, audit deps suffisent.
- **Doc exhaustive partout** : Privilégier des mises à jour ciblées (error-handling, CONTRIBUTING) plutôt qu’une doc sur chaque fichier.
- **Double source de vérité API** : Garder une règle simple (nouveaux appels → httpRequest ; existant → api OK) et la documenter, sans migrer tout le monde pour « uniformiser ».

---

## 7. Synthèse

Le projet est solide et déjà bien analysé ([ANALYSE_PROJET.md](../ANALYSE_PROJET.md)). Les améliorations listées ici ont été mises en place de façon pragmatique : clarification api vs httpRequest, correction des tests (api, expo-image), audit deps qui ne fait échouer que sur vulns high/critical, et documentation de la couverture 80 % et des tests triviaux.

**Pour la suite** : viser 80 % branches côté client en ajoutant des tests sur les chemins d’erreur et la logique métier, sans surtester. Garder ou supprimer `Minimal.test.tsx` selon ta préférence (smoke test vs zéro test trivial).

---

_Dernière mise à jour : Février 2026_
