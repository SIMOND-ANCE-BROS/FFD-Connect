# Module Competitions

## 1) Role metier

Le module competitions couvre la consultation des evenements, les inscriptions (licencies et clubs), le suivi des inscriptions, les resultats et les workflows de check-in.

## 2) Fonctionnalites

- Liste des competitions, details, competition active.
- Synchronisation competitions.
- Inscriptions/annulations (individuelles et club).
- Confirmation d'inscription club.
- Consultation des resultats et des inscrits par event.
- Check-in classique et check-in volontaire via token.
- Creation/mise a jour competition (cas staff/club selon regles backend).

## 3) Endpoints backend

Base controller: `apps/backend/src/competitions/competitions.controller.ts`

Routes principales:

- `GET /competitions`
- `GET /competitions/active`
- `POST /competitions/sync`
- `GET /competitions/club/pending-registrations`
- `POST /competitions/register-member`
- `POST /competitions/unregister-member`
- `POST /competitions/registrations/:registrationId/confirm`
- `GET /competitions/regulation`
- `GET /competitions/:id/for-user`
- `GET /competitions/sync/status`
- `GET /competitions/:id`
- `POST /competitions/:id/register`
- `POST /competitions/:id/unregister`
- `GET /competitions/:id/results`
- `GET /competitions/event/:eventId/registrations`
- `GET /competitions/user/registrations`
- `POST /competitions/:id/checkin`
- `POST /competitions/:id/volunteer/token`
- `POST /competitions/checkin/volunteer`
- `POST /competitions`
- `PATCH /competitions/:id`

## 4) Integration client

Points client principaux:

- `apps/client/src/stores/competition.store.ts`
- `apps/client/src/features/competitions/*`
- `apps/client/src/features/license/services/CheckinService.ts`
- `apps/client/src/features/club/services/CompetitionService.ts`

Navigation ecrans relies:

- `Competitions`
- `CompetitionDetail`
- `LiveResults`
- `EventRegistrants`
- `VolunteerCheckin`
- ecrans club de creation/edition competition

## 5) Regles metier

- Une competition peut etre visible en lecture, mais les actions varient selon role et etat.
- Le check-in volontaire repose sur un token temporaire.
- Les inscriptions club suivent une politique pouvant exiger validation.
- Les operations de sync sont operationnelles et potentiellement longues.

## 6) Flux principal (licencie)

1. L'utilisateur ouvre `Competitions`.
2. Chargement liste via `GET /competitions`.
3. Navigation detail `GET /competitions/:id`.
4. Action inscription via `POST /competitions/:id/register`.
5. Suivi resultat via `GET /competitions/:id/results`.

## 7) Risques et points d'attention

- Forte densite fonctionnelle: fort risque de regressions inter-domaines.
- Check-in et inscriptions doivent etre idempotents cote API.
- La coherence des statuts competition/registration conditionne toute l'UX.

