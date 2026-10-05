# Design : Qualité — Phase 2 (Tests & Teardown)

**Date :** 2026-03-30
**Scope :** Qualité technique — couverture de tests et stabilité du runner
**Sous-projet :** A (sur 3 prévus)

---

## Contexte

Suite à la phase 1 de réduction de dette technique, 4 zones restent à améliorer :

1. Worker teardown non gracieux dans les tests client (8 Timeout handles)
2. `licenses.service.ts` à 24% de branches couvertes
3. `competitions.service.ts` à 43% de branches couvertes
4. Script `sync-licensees-from-compete.ts` sans tests

---

## Point 1 — Teardown worker client

### Problème

`jest --detectOpenHandles` détecte 8 `Timeout` handles sans stack trace exploitable (supprimés par le setup RN/Expo). Un worker est force-killed à chaque run.

### Solution

Isolation par bisection : run les suites une par une avec `--detectOpenHandles` pour identifier le(s) fichier(s) source. Une fois identifiés :

- Si le timer vient d'un mock natif (TrackPlayer, NetInfo) : ajouter `afterAll(() => jest.clearAllTimers())` dans la suite ou dans `jest.setup.js`
- Si le timer vient de code applicatif : appeler `.unref()` sur le handle ou utiliser `jest.useFakeTimers()` dans la suite concernée

### Périmètre

- `apps/client/jest.setup.js` (si le timer est global)
- Fichiers spec identifiés par bisection

### Tests

- `pnpm test` sans warning `force exited` = succès

---

## Point 2 — licenses.service.ts : 24% → 70%+ branches

### Problème

Lignes 166-420 entièrement non couvertes. Le service gère le workflow complet de renouvellement de licence (OCR, upload documents, soumission) avec de nombreuses branches d'erreur non testées.

### Solution

Tests unitaires avec mocks Prisma + mock OCR service dans `licenses.service.spec.ts`. On n'ajoute pas de tests d'intégration (déjà couverts ailleurs).

### Branches à couvrir

**`startRenewalRequest`**

- Request déjà existante → retourner l'existante sans créer

**`renewLicense`**

- User inexistant → NotFoundException
- OCR échoué (licenseNumber null) sans licence existante → BadRequestException

**`uploadRenewalDocument`**

- Request inexistante → NotFoundException
- Request déjà soumise (status ≠ DRAFT) → BadRequestException
- Type MEDICAL_CERTIFICATE + `isApte === false` → BadRequestException
- Type MEDICAL_CERTIFICATE + `isApte` inconnu (ni true ni false) → BadRequestException
- Type LICENSE_CERTIFICATE → chemin normal

**`submitRenewalRequest`**

- Request inexistante → NotFoundException
- Request déjà soumise (status ≠ DRAFT) → BadRequestException
- Document médical manquant → BadRequestException
- Document licence manquant → BadRequestException

### Seuil jest.config.js

Ajouter après implémentation :

```javascript
"./src/licenses/licenses.service.ts": {
  branches: 65,
  functions: 70,
  lines: 70,
  statements: 70,
},
```

---

## Point 3 — competitions.service.ts : 43% → 65%+ branches

### Problème

Lignes 150-392 non couvertes. Le service orchestre inscriptions, sync, check-in et gestion des membres de club.

### Solution

Ajouter des `describe` dans `competitions.service.spec.ts` en utilisant les mocks Prisma/BullMQ déjà en place.

### Branches à couvrir

**`enqueueSyncFFD`**

- Job déjà en cours → ConflictException

**`getSyncStatus`**

- jobId absent dans Redis → réponse sans job
- job introuvable dans BullMQ → réponse sans job

**`registerMember`**

- Event inexistant → NotFoundException (via `ensureMemberBelongsToOrganizerClub`)

**`getPendingRegistrationsForClub`**

- Organizer avec role ≠ CLUB → retourne `[]`
- `sameClubCondition` null → retourne `[]`

**`ensureMemberBelongsToOrganizerClub`**

- Organizer role ≠ CLUB → NotFoundException
- Member inexistant → NotFoundException
- Member dans club différent → NotFoundException

### Seuil jest.config.js

```javascript
"./src/competitions/competitions.service.ts": {
  branches: 60,
  functions: 65,
  lines: 65,
  statements: 65,
},
```

---

## Point 4 — Script sync : extraction fonctions pures + tests

### Problème

`sync-licensees-from-compete.ts` (895 lignes) n'a aucun test. Le script est entièrement couplé à Prisma et aux APIs externes, mais contient 4 fonctions pures extractables.

### Fonctions à extraire

Les fonctions suivantes existent déjà dans le script (lignes ~235-285) et seront déplacées dans un fichier utilitaire :

- `normalizeForMatch(s: string): string` — normalise une chaîne pour le matching (NFD, trim, lowercase)
- `parseFullName(fullName: string): { firstName: string; lastName: string }` — parse "DUPONT Jean" → `{ firstName: "Jean", lastName: "Dupont" }`
- `parseRank(rankStr: string): number` — parse "8- 9" → 8, "1" → 1
- `parseClubNames(clubStr: string): { primary: string; secondary: string | null }` — parse "Club A - Club B" → `{ primary: "Club A", secondary: "Club B" }`

### Nouveau fichier

`apps/backend/scripts/sync-licensees.utils.ts` — exporte les 4 fonctions

### Tests

`apps/backend/scripts/sync-licensees.utils.spec.ts` — tests unitaires purs (pas de mock)

Cas de test par fonction :

- `normalizeForMatch` : accents, majuscules, espaces multiples
- `parseFullName` : prénom composé, nom composé, un seul mot
- `parseRank` : entier simple, plage "8- 9", chaîne invalide → 999
- `parseClubNames` : club unique, deux clubs, chaîne vide

### Non-périmètre

Le script principal `sync-licensees-from-compete.ts` garde ses appels Prisma non testés — acceptable car les effets DB sont couverts par les tests d'intégration existants.

---

## Ordre d'implémentation

1. **Teardown** — quick win, impact immédiat sur la stabilité du CI
2. **Script utils** — extraction pure, 0 risque de régression
3. **licenses.service** — plus long mais impact couverture maximal
4. **competitions.service** — complète le tableau

---

## Non-périmètre

- `payment.service.ts` — déjà à 97%, pas touché
- Refactoring complet du script sync
- Tests d'intégration nouveaux (DB réelle)
- Modules déjà bien couverts (health, common, auth)
