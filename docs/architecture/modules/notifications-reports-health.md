# Module Notifications + Reports + Health

## 1) Role metier

Ce domaine regroupe les fonctions de support operationnel: notifications utilisateur, signalement in-app, et supervision API.

## 2) Fonctionnalites

- Lecture et acquittement des notifications.
- Envoi de rapport bug/feature depuis client (avec contexte et image).
- Endpoints de sante applicative et metriques.

## 3) Endpoints backend

Controllers:

- `apps/backend/src/notifications/notifications.controller.ts`
- `apps/backend/src/reports/reports.controller.ts`
- `apps/backend/src/health/health.controller.ts`

Routes:

- `GET /notifications`
- `PATCH /notifications/:id/read`
- `POST /notifications/read-all`
- `POST /reports`
- `GET /health/live`
- `GET /health`
- `GET /health/metrics`

## 4) Integration client

Points client principaux:

- `apps/client/src/services/BackendService.ts` (notifications)
- `apps/client/src/features/competitions/services/ReportService.ts` (reports)
- `apps/client/src/hooks/useBackendHealth.ts` (health)

Specificites:

- `ReportService` envoie un multipart avec metadata device + logs applicatifs.
- Les notifications utilisent le token auth standard.
- Le health est utilise pour diagnostiquer indisponibilites backend.

## 5) Regles metier

- Les notifications non lues doivent etre traquees de maniere fiable.
- Le rapport utilisateur ne doit pas bloquer l'UX (fire-and-log).
- Les endpoints health doivent rester legers et stables.

## 6) Flux principal (report bug)

1. L'utilisateur remplit le formulaire de signalement.
2. Le client agregue contexte (device, user, logs).
3. Upload via `POST /reports` (multipart/form-data).
4. Cote backend, traitement/stockage puis suivi operationnel.

## 7) Risques et points d'attention

- Exposition de donnees sensibles dans les logs de report (a sanitiser).
- Volume potentiel des pieces jointes image.
- Les metrics doivent rester coherentes avec les alertes ops.

