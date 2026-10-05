# Sentry : erreurs et logs des builds beta (front)

Pour recevoir les **erreurs** et le **contexte** (breadcrumbs, environment) des builds **preview** (beta) dans Sentry.

## 1. Variables EAS pour le profil `preview`

Dans **EAS Dashboard** → ton projet → **Secrets** (ou **Environment variables** pour le profil `preview`), définir :

| Variable                 | Obligatoire              | Description                                                                                                                                         |
| ------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_SENTRY_DSN` | Oui                      | DSN du projet Sentry (ex. `https://xxx@xxx.ingest.sentry.io/xxx`). Sans lui, Sentry n’est pas initialisé et aucune erreur n’est envoyée.            |
| `SENTRY_AUTH_TOKEN`      | Recommandé               | Token Sentry pour l’upload des source maps (stack traces déchiffrées dans Sentry).                                                                  |
| `EXPO_PUBLIC_APP_ENV`    | Non (déjà dans eas.json) | Le profil `preview` définit déjà `EXPO_PUBLIC_APP_ENV=preview` dans `eas.json` pour taguer les événements en **environment = preview** dans Sentry. |

Après ajout ou modification de secrets, **refaire un build** (ex. `pnpm run build:beta` ou `pnpm run build:beta:ios`) pour que les nouvelles variables soient prises en compte.

## 2. Ce qui est envoyé à Sentry en build beta

- **Erreurs** : exceptions non gérées et `Sentry.captureException()` / `Sentry.captureMessage()`.
- **Breadcrumbs** : navigation, requêtes réseau, etc. (affichés sur chaque issue).
- **Logs structurés** : tout ce qui passe par le **logger** de l’app (`src/utils/logger.ts`). En local (`__DEV__`) les logs vont uniquement en console ; en preview/production ils sont aussi envoyés dans la section **Logs** de Sentry.
- **Environment** : `preview` (grâce à `EXPO_PUBLIC_APP_ENV=preview` dans le profil `preview` de `eas.json`).

**Utiliser le logger partout** : `createLogger('MonModule')` puis `logger.info()`, `logger.warn()`, `logger.error()` pour que les logs soient visibles en beta/prod dans Sentry. Éviter `console.log` dans le code métier.

## 3. Vérifier dans Sentry

1. **Filtrer par environment** : dans Sentry, filtrer par **Environment** = `preview` pour ne voir que les builds beta.
2. **Vérifier la réception** : au lancement de l’app, un message « FFD Connect app started » est envoyé en `info` ; s’il apparaît sur le projet avec environment `preview`, la config est bonne.

## 4. Résumé checklist

- [ ] `EXPO_PUBLIC_SENTRY_DSN` défini dans EAS pour les builds du profil `preview`.
- [ ] Optionnel : `SENTRY_AUTH_TOKEN` pour les source maps.
- [ ] `EXPO_PUBLIC_APP_ENV=preview` déjà présent dans `eas.json` pour le profil `preview`.
- [ ] Rebuild après toute modification des variables EAS.
