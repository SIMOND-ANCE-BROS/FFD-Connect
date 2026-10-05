# Module Licenses + WDSF

## 1) Role metier

Ce domaine gere la licence FFD (consultation et renouvellement) et l'integration WDSF (verification par MIN et rattachement au profil).

## 2) Fonctionnalites

- Consultation de la licence courante.
- Upload de documents de renouvellement.
- Workflow de renouvellement (start, upload docs, submit, approve).
- Verification d'une licence WDSF.
- Persistance des donnees WDSF sur le profil utilisateur.

## 3) Endpoints backend

Base controllers:

- `apps/backend/src/licenses/licenses.controller.ts`
- `apps/backend/src/wdsf/wdsf.controller.ts`

Routes:

- `GET /licenses/my`
- `POST /licenses/upload`
- `POST /licenses/renew`
- `POST /licenses/renewal/start`
- `GET /licenses/renewal/my`
- `POST /licenses/renewal/:id/documents`
- `POST /licenses/renewal/:id/submit`
- `POST /licenses/renewal/:id/approve`
- `GET /wdsf/athlete/:min`
- `PATCH /users/me` (enregistrement WDSF cote profil)

## 4) Integration client

Points client principaux:

- `apps/client/src/services/BackendService.ts`
- `apps/client/src/features/auth/services/AuthService.ts` (WDSF)
- `apps/client/src/features/license/services/CheckinService.ts`
- ecrans `LicenseScreen`, `LicenseRenewalScreen`, `ScannerScreen`

Specificites:

- Uploads fichiers via multipart/form-data (web et natif differencies).
- OCR mentionne dans le workflow de documents de renouvellement.

## 5) Regles metier

- Un renouvellement suit un cycle d'etat (`DRAFT`, `PENDING`, `APPROVED`, `REJECTED`).
- La soumission exige les pieces requises.
- Le rattachement WDSF est une operation explicite, post-verification.
- Les operations de licence sont reservees aux utilisateurs authentifies.

## 6) Flux principal (renouvellement)

1. Start draft via `POST /licenses/renewal/start`.
2. Upload documents via `POST /licenses/renewal/:id/documents`.
3. Soumission via `POST /licenses/renewal/:id/submit`.
4. Validation staff/admin via `POST /licenses/renewal/:id/approve`.

## 7) Risques et points d'attention

- Robustesse upload mobile/web (formats, timeout, taille).
- Cohesion entre donnees OCR et validation metier.
- Evolution des champs WDSF a maintenir synchronisee backend/client.

