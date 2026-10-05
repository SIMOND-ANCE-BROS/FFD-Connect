# Module Clubs

## 1) Role metier

Le domaine clubs porte l'espace club: parametres d'inscription, membres, partenariats (couples), et equipes solo.

## 2) Fonctionnalites

- Lecture/mise a jour du mode d'inscription du club.
- Recuperation du statut HelloAsso.
- Gestion des partenariats (creation, validation, cloture).
- Recuperation des membres eligibles aux partenariats.
- Gestion des solo teams (CRUD fonctionnel partiel: create/list/detail/add/remove members).

## 3) Endpoints backend

Base controller: `apps/backend/src/clubs/clubs.controller.ts`

Routes:

- `GET /clubs/me/registration-mode`
- `PATCH /clubs/me/registration-mode`
- `GET /clubs/me/helloasso`
- `GET /clubs/me/partnerships`
- `POST /clubs/me/partnerships`
- `PATCH /clubs/me/partnerships/:id/end`
- `PATCH /clubs/me/partnerships/:id/validate`
- `GET /clubs/me/partnerships/clubs`
- `GET /clubs/me/partnerships/members`
- `GET /clubs/me/solo-teams`
- `POST /clubs/me/solo-teams`
- `GET /clubs/me/solo-teams/:id`
- `POST /clubs/me/solo-teams/:id/members`
- `DELETE /clubs/me/solo-teams/:id/members/:userId`

## 4) Integration client

Points client principaux:

- `apps/client/src/features/club/services/ClubService.ts`
- `apps/client/src/features/club/screens/*`
- `apps/client/src/navigation/AppNavigator.tsx` (cluster ecrans club)

Ecrans relies:

- `ClubDashboard`
- `ClubCompetitions`
- `ClubCompetitionEditor`
- `ClubMembers`
- `ClubMemberEditor`
- `ClubRegistrations`
- `ClubCouples`
- `ClubSoloTeams`
- `ClubSoloTeamDetail`

## 5) Regles metier

- Le mode d'inscription club impacte directement les workflows competitions.
- Le partenariat peut impliquer un club secondaire et une validation explicite.
- Les filtres d'eligibilite membres (categorie, age, niveau) sont appliques cote client en pre-validation UX.
- Certaines operations club necessitent role `CLUB` (ou droits equvalents backend).

## 6) Flux principal (couple club)

1. Le club charge les membres eligibles.
2. Creation d'un partenariat via `POST /clubs/me/partnerships`.
3. Si besoin, validation secondaire `PATCH .../validate`.
4. Le partenariat devient exploitable pour les inscriptions competitions.

## 7) Risques et points d'attention

- Couplage fort avec `competitions` et `career`.
- Les incoherences de statut partenariat creent des blocages d'inscription.
- Le filtrage client ne remplace pas les controles d'autorisation backend.

