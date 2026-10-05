# Quality Phase 3 — Contrats HTTP + Branch Coverage — Design

**Date:** 2026-03-30
**Scope:** Groupe A des suggestions techniques — nock + couverture de branches

---

## Contexte

Suite à l'audit technique du projet, deux lacunes de qualité tests ont été identifiées :

1. Les intégrations externes (WDSF, HelloAsso, Google Vision) ne sont pas testées au niveau contrat HTTP — les mocks couvrent l'appel interne mais pas ce qui est envoyé/reçu sur le réseau.
2. La couverture de branches globale est à 56%, tirée vers le bas par les modules métier critiques (competitions, clubs, licenses, payment).

Les fixtures JSON (`test/fixtures/`) ont été créées dans la phase précédente mais `nock` n'a pas été installé.

---

## Architecture

### Nock — contrats externes

`nock` intercepte les appels HTTP sortants au niveau Node.js (avant qu'ils quittent le process). Il fonctionne avec `HttpService` de `@nestjs/axios` sans aucun changement dans le code de production.

Chaque service externe reçoit des tests dans son `.spec.ts` existant, dans un `describe` dédié `"contrats API"` :

**WDSF** (`wdsf.service.spec.ts`)

- GET athlète → 200 avec fixture `athlete-profile.json`
- GET athlète → 401 avec fixture `error-401.json`
- GET athlète → 404 (athlète inconnu)
- GET athlète → timeout réseau (`ECONNABORTED`)

**HelloAsso** (`payment.service.spec.ts`)

- POST checkout → paiement confirmé avec fixture `payment-confirmed.json`
- POST checkout → paiement refusé avec fixture `payment-failed.json`
- POST checkout → timeout réseau

**Google Vision** (`licenses.service.spec.ts`)

- POST annotate → OCR succès avec fixture `license-scan-success.json`
- POST annotate → confidence faible avec fixture `license-scan-low-confidence.json`

Chaque `describe` inclut un `afterEach(() => nock.cleanAll())` pour isolation.

### Branch coverage — modules critiques

Approche coverage-driven : lancer `jest --coverage` par module, identifier les branches non couvertes, écrire les tests ciblés sur les error paths et null checks. Formaliser les seuils dans `jest.config.js` une fois atteints.

Cibles :

| Module       | Cible branches |
| ------------ | -------------- |
| competitions | 72%            |
| clubs        | 70%            |
| licenses     | 75%            |
| payment      | 80%            |

Branches prioritaires par module :

**competitions.service.ts**

- `findOne` : compétition inexistante → NotFoundException
- `register` : utilisateur déjà inscrit, compétition fermée
- `unregister` : inscription inexistante
- `checkIn` : QR invalide, déjà checké

**clubs.service.ts**

- `createPartnership` : club inexistant, partenariat déjà actif
- `validatePartnership` : token invalide, partenariat déjà validé
- `endPartnership` : partenariat inexistant

**licenses.service.ts**

- `getLicense` : aucune licence trouvée
- `submitRenewalRequest` : documents manquants, requête déjà soumise
- `approveRenewalRequest` : requête inexistante

**payment.service.ts**

- branches déjà bien couvertes (~72%) — compléter les cas edge HelloAsso

---

## Composants modifiés

- `apps/backend/package.json` — ajout `nock` + `@types/nock` en devDependencies
- `apps/backend/src/wdsf/wdsf.service.spec.ts` — ajout describe "contrats API"
- `apps/backend/src/payment/payment.service.spec.ts` — ajout describe "contrats API HelloAsso"
- `apps/backend/src/licenses/licenses.service.spec.ts` — ajout describe "contrats API Vision" + tests branches
- `apps/backend/src/competitions/competitions.service.spec.ts` — ajout tests branches
- `apps/backend/src/competitions/services/competition-registration.service.spec.ts` — ajout tests branches
- `apps/backend/src/clubs/clubs.service.spec.ts` — ajout tests branches
- `apps/backend/jest.config.js` — mise à jour seuils par module

---

## Gestion d'erreurs

- `nock.cleanAll()` dans `afterEach` pour éviter les fuites entre tests
- `nock.disableNetConnect()` dans `beforeAll` du suite nock pour garantir qu'aucun appel réseau réel ne passe en test

---

## Tests

Chaque tâche se valide par :

1. `pnpm test <service>.spec.ts` → tous verts
2. `pnpm test --coverage` → seuils atteints sans erreur

Les seuils sont formalisés dans `jest.config.js` uniquement une fois le coverage réellement atteint (pas de seuils aspirationnels).
