# Module Auth + Users

## 1) Role metier

Ce domaine gere l'acces a l'application, la session utilisateur, le cycle de mot de passe et la lecture/mise a jour du profil.

## 2) Fonctionnalites

- Connexion utilisateur avec attribution de role.
- Refresh et invalidation de session.
- Recuperation et reset de mot de passe.
- Changement de mot de passe authentifie.
- Lecture du profil courant et mise a jour partielle (`/users/me`).
- Lecture de membres (`/users/members`) pour usages club.

## 3) Endpoints backend

Base controllers:

- `apps/backend/src/auth/auth.controller.ts`
- `apps/backend/src/users/users.controller.ts`

Routes:

- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/change-password`
- `GET /users/me`
- `PATCH /users/me`
- `GET /users/members`

## 4) Integration client

Principaux points d'entree:

- `apps/client/src/features/auth/services/AuthService.ts`
- `apps/client/src/services/api.ts`
- `apps/client/src/navigation/AppNavigator.tsx`

Comportements client:

- Auth locale stockee dans `AsyncStorage` (`auth_config`).
- Injection automatique du token Bearer par interceptor Axios.
- En cas de `401` (hors login/forgot-password), nettoyage du token.
- Mapping role backend vers UX navigation:
  - backend: `LICENSEE | CLUB | STAFF | ADMIN`
  - client ajoute `GUEST` pour parcours invite.

## 5) Regles metier

- Le role pilote la navigation et les onglets visibles.
- `GUEST` est purement client (pas un role backend persiste).
- Les operations sensibles (changement mdp, profil) exigent session valide.
- Les erreurs de login sont normalisees pour UX (`401` => message metier explicite).

## 6) Flux principal

1. L'utilisateur saisit ses credentials.
2. `AuthService.login()` appelle `POST /auth/login`.
3. Le token et les metadonnees de role/profil sont persistes dans `auth_config`.
4. `AppNavigator` ouvre `Main` et affiche les onglets selon le role.
5. Les appels suivants utilisent automatiquement `Authorization: Bearer ...`.

## 7) Risques et points d'attention

- La coherence role backend/client est critique pour la securite UX.
- Le nettoyage automatique sur `401` peut deconnecter abruptement en cas de backend instable.
- Toute evolution de format de reponse login doit rester compatible avec `AuthService`.

