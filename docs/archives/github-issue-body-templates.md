d# Format du corps des Epics et Issues — FFD Connect

Ce document définit le format standard du **body** (description) des Epics et des Issues (tâches) dans GitHub, pour garder une structure homogène et lisible.

---

## 1. Format Epic

Les Epics décrivent un objectif fonctionnel de haut niveau et le périmètre (module backend ou feature client). La relation **Parent** est gérée par GitHub (Relationships) ; inutile de la répéter dans le corps.

### Template

```markdown
## Objectif

[Une phrase ou deux décrivant la valeur métier et le périmètre de l'epic.]

## Périmètre

| Élément              | Détail                                                                            |
| -------------------- | --------------------------------------------------------------------------------- |
| **Module / Feature** | `auth` / `competitions` / `license` (backend) ou `auth` / `competitions` (client) |
| **Stack**            | Backend (NestJS) / Client (Expo)                                                  |

## Livrables (tâches liées)

Les tâches sont liées via la relation **Parent issue** (Relationships). Voir les sub-issues de cette epic.

## Notes

[Optionnel : dépendances, contraintes, liens vers la doc ou l'API.]

- **Definition of Done** : toutes les sub-issues fermées et critères validés.
```

### Exemple rempli (EPIC-1)

```markdown
## Objectif

Gérer l'identité, les sessions et la récupération de mot de passe pour les utilisateurs de l'app FFD Connect.

## Périmètre

| Élément    | Détail           |
| ---------- | ---------------- |
| **Module** | `auth`           |
| **Stack**  | Backend (NestJS) |

## Livrables (tâches liées)

Les tâches (login, refresh token, logout, forgot/reset/change password) sont liées via **Parent issue**. Voir les sub-issues de cette epic.

## Notes

- JWT Guard, JWT Strategy, bcrypt, rate limiting sur login.
- Doc : `docs/error-handling.md`, `README.md` (sécurité).
```

---

## 2. Format Issue (tâche)

Chaque issue décrit une tâche précise (endpoint, écran, feature). La relation avec l'Epic se fait via **Relationships > Parent issue** (pas besoin de la dupliquer dans le corps).

### Template

```markdown
## Contexte

[Une phrase pour situer la tâche dans l'epic ou le flux utilisateur.]

## Description

[Comportement attendu, endpoint ou écran concerné, cas nominal et limites.]

## Critères d'acceptation

- [ ] [Critère 1 mesurable]
- [ ] [Critère 2]
- [ ] [Critère 3]

## QA & Tests requis

- [ ] Tests unitaires (si applicable)
- [ ] Tests d'intégration / E2E (si applicable)

## Notes techniques (optionnel)

- Endpoint : `METHOD /path` ou Écran : `Screens/...`
- Fichiers concernés : `src/...`
- Contraintes : rate limit, rôles, etc.
- **Branche suggérée** : `feat/ID-nom-de-la-feature` ou `fix/ID-nom-du-bug`

## Sous-tâches (optionnel)

Pour détailler en sub-issues, créer des issues et les lier avec **Parent issue** pointant vers cette issue.
```

### Exemple rempli (AUTH-1)

```markdown
## Contexte

Permettre à un utilisateur de se connecter avec son email/identifiant et son mot de passe pour obtenir un accès authentifié (JWT).

## Description

- **Endpoint** : `POST /auth/login`
- **Body** : `username` (email ou identifiant), `password`
- **Réponse attendue** : `access_token`, `refresh_token`, objet `user` (id, email, firstName, lastName, role, clubName, licenseNumber).
- En cas d'identifiants invalides : HTTP 401.

## Critères d'acceptation

- [ ] Réponse 200 avec `access_token`, `refresh_token` et `user` lorsque les identifiants sont valides.
- [ ] Réponse 401 avec message explicite lorsque les identifiants sont invalides.
- [ ] Endpoint documenté dans Swagger (`/api`).

## Notes techniques

- Service : `AuthService.validateUser()` + `login()`.
- Rate limiting global appliqué sur la route.
```

### Exemple issue client (CL-COMP-1)

```markdown
## Contexte

Afficher la liste des compétitions disponibles avec filtres et pagination pour que l'utilisateur puisse choisir une compétition.

## Description

- **Écran** : `CompetitionsScreen`
- **API** : `GET /competitions` (JWT), paramètres de pagination.
- **UI** : liste avec filtres (date, statut), pagination (infinite scroll ou bouton « Voir plus »).

## Critères d'acceptation

- [ ] La liste affiche les compétitions retournées par l'API.
- [ ] Les filtres (date, statut) mettent à jour la liste.
- [ ] La pagination fonctionne sans doublon ni trou.
- [ ] États de chargement et erreur gérés (message utilisateur).

## Notes techniques

- Hook : `useCompetitionsLogic`, context : `CompetitionContext`.
```

---

## 3. Règles communes

| Règle           | Epic                                    | Issue                                                             |
| --------------- | --------------------------------------- | ----------------------------------------------------------------- |
| **Titre**       | `EPIC-N : [Nom court]`                  | `ID: [Titre court]` (ex. `AUTH-1: Login (...)`)                   |
| **Parent**      | Aucun (epic = racine)                   | Lien via **Relationships > Parent issue** (Epic ou tâche parente) |
| **Labels**      | `epic` + `backend` ou `client` + thème  | `backend`/`client` + thème (`auth`, `competitions`, etc.)         |
| **Objectif**    | Décrire le « pourquoi » et le périmètre | Décrire le « quoi » et le « comment »                             |
| **Acceptation** | Pas de checklist obligatoire            | Checklist en `- [ ]` pour la revue                                |

---

## 4. Sous-tâches (niveau 3)

Pour une **sous-tâche** (enfant d’une tâche déjà liée à une Epic) :

- **Titre** : `ID-1: [Sous-titre]` (ex. `AUTH-1-1: Validation formulaire login`).
- **Body** : même format que l’issue (Contexte, Description, Critères d’acceptation).
- **Relation** : **Parent issue** = la tâche (ex. AUTH-1), pas l’Epic.

Hiérarchie : **Epic** → **Tâche** → **Sous-tâche**.

---

## 5. Résumé

- **Epic** : Objectif + Périmètre + renvoi aux sub-issues (Relationships).
- **Issue** : Contexte + Description + Critères d’acceptation (checklist) + optionnel Notes techniques / Sous-tâches.
- Pas de doublon du lien parent dans le corps : tout passe par **Relationships** dans l’interface GitHub.

Ces templates peuvent être copiés-collés à la création manuelle d’issues ou utilisés par les scripts de génération (`scripts/github-issues-data.json`, `scripts/create-github-issues.mjs`).
