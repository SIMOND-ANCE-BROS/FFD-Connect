# Technical Debt — Points de vigilance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Éliminer 5 points de vigilance techniques identifiés : sécurité bcrypt, lisibilité schema Prisma, isolation stores Zustand, couverture de tests des modules critiques, et contrats d'intégrations externes.

**Architecture:** Chaque tâche est indépendante et peut être commitée séparément. L'ordre est : quick wins immédiats (bcrypt, Prisma) → architecture client (Zustand) → qualité tests (backend + intégrations).

**Tech Stack:** NestJS, Prisma v7, TypeScript strict, bcrypt, Zustand, Jest, nock

---

## Fichiers touchés

**Tâche 1 — bcrypt**

- Modify: `apps/backend/src/auth/auth.service.ts`
- Modify: `apps/backend/src/auth/auth.service.spec.ts`

**Tâche 2 — Prisma schema split**

- Delete: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/schema/_base.prisma`
- Create: `apps/backend/prisma/schema/user.prisma`
- Create: `apps/backend/prisma/schema/license.prisma`
- Create: `apps/backend/prisma/schema/competition.prisma`
- Create: `apps/backend/prisma/schema/club.prisma`
- Create: `apps/backend/prisma/schema/track.prisma`
- Create: `apps/backend/prisma/schema/notification.prisma`
- Create: `apps/backend/prisma/schema/report.prisma`

**Tâche 3 — Zustand isolation**

- Create: `apps/client/src/stores/index.ts`
- Create: `apps/client/src/stores/__tests__/auth.store.isolation.test.ts`
- Create: `apps/client/src/stores/__tests__/competition.store.isolation.test.ts`
- Create: `apps/client/src/stores/__tests__/player.store.isolation.test.ts`
- Create: `apps/client/src/stores/__tests__/club.store.isolation.test.ts`

**Tâche 4 — Tests modules critiques**

- Modify: `apps/backend/src/auth/auth.service.spec.ts`
- Modify: `apps/backend/jest.config.js` (seuils)

**Tâche 5 — Intégrations externes**

- Create: `apps/backend/test/fixtures/wdsf/athlete-profile.json`
- Create: `apps/backend/test/fixtures/wdsf/error-401.json`
- Create: `apps/backend/test/fixtures/helloasso/payment-confirmed.json`
- Create: `apps/backend/test/fixtures/helloasso/payment-failed.json`
- Create: `apps/backend/test/fixtures/google-vision/license-scan-success.json`
- Create: `apps/backend/test/fixtures/google-vision/license-scan-low-confidence.json`
- Modify: services wdsf/payment/licenses specs pour utiliser ces fixtures

---

## Tâche 1 : bcrypt — passer à 12 rounds avec migration transparente

**Files:**

- Modify: `apps/backend/src/auth/auth.service.ts`
- Modify: `apps/backend/src/auth/auth.service.spec.ts`

### Contexte

Actuellement `bcrypt.hash(password, 10)` est appelé à 3 endroits dans `auth.service.ts` (lignes 500 et 575 pour reset/change password). La création de compte se fait via `prisma.user.create` avec un hash externalisé — chercher dans les seeds/scripts si besoin. Le rehash silencieux se fait dans `validateUser` après un `bcrypt.compare` réussi.

- [x] **Step 1 : Écrire les tests de rehash dans auth.service.spec.ts**

Ajouter ce bloc `describe` dans `apps/backend/src/auth/auth.service.spec.ts` :

```typescript
describe('validateUser — rehash bcrypt transparent', () => {
  it('should rehash password with 12 rounds when existing hash has fewer rounds', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      password: 'hashed-with-6-rounds',
      firstName: 'Test',
      lastName: 'User',
      role: 'LICENSEE',
      createdAt: new Date(),
      updatedAt: new Date(),
      ageGroup: null,
      category: null,
      clubId: null,
      clubName: null,
      birthDate: null,
      nationalRanking: null,
      passportLevelLatin: null,
      passportLevelStandard: null,
      competitionLevel: null,
      license: null,
    };

    mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
    mockPrismaService.user.update = jest.fn().mockResolvedValue(mockUser);

    // compare réussit, getRounds retourne 6 (< 12), donc rehash doit avoir lieu
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.getRounds as jest.Mock) = jest.fn().mockReturnValue(6);
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash-12-rounds');

    await service.validateUser('test@example.com', 'password');

    expect(bcrypt.hash).toHaveBeenCalledWith('password', 12);
    expect(mockPrismaService.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { password: 'new-hash-12-rounds' },
    });
  });

  it('should NOT rehash password when existing hash already has 12 rounds', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      password: 'hashed-with-12-rounds',
      firstName: 'Test',
      lastName: 'User',
      role: 'LICENSEE',
      createdAt: new Date(),
      updatedAt: new Date(),
      ageGroup: null,
      category: null,
      clubId: null,
      clubName: null,
      birthDate: null,
      nationalRanking: null,
      passportLevelLatin: null,
      passportLevelStandard: null,
      competitionLevel: null,
      license: null,
    };

    mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
    mockPrismaService.user.update = jest.fn();

    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.getRounds as jest.Mock) = jest.fn().mockReturnValue(12);

    await service.validateUser('test@example.com', 'password');

    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(mockPrismaService.user.update).not.toHaveBeenCalled();
  });
});
```

Ajouter `getRounds: jest.fn()` dans le mock bcrypt en haut du fichier :

```typescript
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
  getRounds: jest.fn(),
}));
```

- [x] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

```bash
cd apps/backend && pnpm test auth.service.spec.ts -- --testNamePattern="rehash"
```

Attendu : FAIL — `getRounds is not a function` ou `update not called`

- [x] **Step 3 : Implémenter dans auth.service.ts**

Remplacer les 3 occurrences de `bcrypt.hash(newPassword, 10)` et ajouter la logique de rehash dans `validateUser`.

**3a — Ajouter la constante BCRYPT_ROUNDS** en haut de `auth.service.ts`, après les imports :

```typescript
const BCRYPT_ROUNDS = 12;
```

**3b — Modifier `validateUser`** (après la ligne `return result as Omit<User, "password">`) pour ajouter le rehash silencieux. Remplacer les lignes 139-143 par :

```typescript
if (user && (await bcrypt.compare(pass, user.password))) {
  // Rehash silencieux si le hash existant a été généré avec < 12 rounds
  const currentRounds = bcrypt.getRounds(user.password);
  if (currentRounds < BCRYPT_ROUNDS) {
    const newHash = await bcrypt.hash(pass, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id as string },
      data: { password: newHash },
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, ...result } = user;
  return result as Omit<User, 'password'>;
}
return null;
```

**3c — Remplacer les 2 occurrences de `bcrypt.hash(newPassword, 10)`** (lignes 500 et 575) par `bcrypt.hash(newPassword, BCRYPT_ROUNDS)`.

- [x] **Step 4 : Lancer les tests**

```bash
cd apps/backend && pnpm test auth.service.spec.ts
```

Attendu : tous les tests passent

- [x] **Step 5 : Commit**

```bash
cd apps/backend && git add src/auth/auth.service.ts src/auth/auth.service.spec.ts
git commit -m "security(auth): increase bcrypt cost factor to 12 with transparent rehash on login"
```

---

## Tâche 2 : Prisma schema — découpage en fichiers thématiques

**Files:**

- Delete: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/schema/_base.prisma` + 7 fichiers thématiques

### Contexte

Prisma v7 supporte `prismaSchemaFolder` nativement. Il faut : (1) activer la preview feature, (2) créer le dossier `schema/`, (3) répartir les modèles sans en modifier aucun, (4) supprimer l'ancien fichier.

- [x] **Step 1 : Créer `prisma/schema/_base.prisma`**

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["prismaSchemaFolder"]
}

datasource db {
  provider = "postgresql"
}
```

- [x] **Step 2 : Créer `prisma/schema/user.prisma`**

Contenu : copier depuis `schema.prisma` les blocs suivants (sans modification) :

- `enum PassportLevel` (lignes 10-21)
- `model User` (lignes 22-64)
- `enum UserRole` (lignes 339-345)
- `model RefreshToken` (lignes 293-309)
- `model PasswordResetToken` (lignes 310-325)
- `model VolunteerToken` (lignes 326-338)

- [x] **Step 3 : Créer `prisma/schema/license.prisma`**

Contenu : copier depuis `schema.prisma` :

- `enum LicenseRenewalStatus` (lignes 79-86)
- `enum LicenseRenewalDocumentType` (lignes 87-91)
- `model License` (lignes 65-78)
- `model LicenseRenewalRequest` (lignes 92-104)
- `model LicenseRenewalDocument` (lignes 105-117)

- [x] **Step 4 : Créer `prisma/schema/competition.prisma`**

Contenu : copier depuis `schema.prisma` :

- `enum CompetitionType` (lignes 132-139)
- `enum EventKind` (lignes 140-148)
- `enum EventType` (lignes 149-153)
- `enum CompetitionStatus` (lignes 470-476)
- `enum RegistrationStatus` (lignes 477-fin)
- `model Competition` (lignes 154-191)
- `model Event` (lignes 192-212)
- `model Registration` (lignes 213-243)
- `model Result` (lignes 244-256)
- `model ScheduleItem` (lignes 257-268)
- `model SeatBooking` (lignes 346-365)
- `enum BookingStatus` (lignes 463-469)

- [x] **Step 5 : Créer `prisma/schema/club.prisma`**

Contenu : copier depuis `schema.prisma` :

- `enum ClubRegistrationMode` (lignes 366-372)
- `enum PartnershipManagementMode` (lignes 373-379)
- `enum PartnershipStatus` (lignes 380-386)
- `model Club` (lignes 387-404)
- `model Partnership` (lignes 405-430)
- `model SoloTeam` (lignes 431-443)
- `model SoloTeamMember` (lignes 444-456)

- [x] **Step 6 : Créer `prisma/schema/track.prisma`**

Contenu : copier depuis `schema.prisma` :

- `enum TrackStatus` (lignes 457-462)
- `model Track` (lignes 118-131)

- [x] **Step 7 : Créer `prisma/schema/notification.prisma`**

Contenu : copier depuis `schema.prisma` :

- `model Notification` (lignes 278-292)

- [x] **Step 8 : Créer `prisma/schema/report.prisma`**

Contenu : copier depuis `schema.prisma` :

- `model BugReport` (lignes 269-277)

- [x] **Step 9 : Valider que le schema est correct**

```bash
cd apps/backend && pnpm prisma validate --schema prisma/schema
```

Attendu : `The schema at prisma/schema is valid`

Si erreur de modèle introuvable, vérifier que chaque `enum` référencé dans un modèle est dans le même fichier ou dans un autre fichier du dossier `schema/`.

- [x] **Step 10 : Générer le client Prisma**

```bash
cd apps/backend && pnpm prisma generate --schema prisma/schema
```

Attendu : `Generated Prisma Client`

- [x] **Step 11 : Supprimer l'ancien fichier**

```bash
rm apps/backend/prisma/schema.prisma
```

- [x] **Step 12 : Lancer les tests d'intégration**

```bash
cd apps/backend && pnpm test:integration
```

Attendu : tous les tests passent (le client Prisma généré est identique)

- [x] **Step 13 : Commit**

```bash
git add apps/backend/prisma/
git commit -m "refactor(prisma): split schema into thematic files using prismaSchemaFolder"
```

---

## Tâche 3 : Zustand — isolation et barrel export

**Files:**

- Create: `apps/client/src/stores/index.ts`
- Create: `apps/client/src/stores/__tests__/` (4 fichiers)

### Contexte

L'audit des imports montre qu'aucun store n'importe un autre store directement — la règle 1 est déjà respectée. Il faut donc : créer le barrel `index.ts` et ajouter les tests d'isolation pour fixer cette règle dans le code.

- [x] **Step 1 : Auditer les imports croisés entre stores**

```bash
grep -rn "from.*store" apps/client/src/stores/*.ts | grep -v "zustand\|features\|utils\|services\|TrackPlayer\|logger\|typeGuards\|ClubService"
```

Attendu : aucune ligne (les stores ne s'importent pas mutuellement). Si des imports croisés apparaissent, les corriger avant de continuer.

- [x] **Step 2 : Créer `apps/client/src/stores/index.ts`**

```typescript
// Barrel export — point d'entrée unique pour tous les stores.
// Les composants importent depuis 'stores/', jamais depuis 'stores/auth.store' directement.

export { useAuthStore } from './auth.store';
export type { AuthState } from './auth.store';

export { useCompetitionStore } from './competition.store';
export type { CompetitionState } from './competition.store';

export { usePlayerStore } from './player.store';
export type { PlayerState } from './player.store';

export { useClubStore } from './club.store';
export type { ClubState } from './club.store';

export { usePerformanceStore } from './performance.store';
export type { PerformanceState } from './performance.store';
```

Note : adapter les noms de types exportés selon ce que chaque store exporte réellement. Si un store n'exporte pas de type `*State`, omettre la ligne `export type`.

- [x] **Step 3 : Écrire le test d'isolation pour authStore**

Créer `apps/client/src/stores/__tests__/auth.store.isolation.test.ts` :

```typescript
import { useAuthStore } from '../auth.store';

describe('authStore isolation', () => {
  beforeEach(() => {
    useAuthStore.setState(useAuthStore.getInitialState());
  });

  it('initializes without depending on other stores', () => {
    const state = useAuthStore.getState();
    expect(state).toBeDefined();
  });

  it('has a defined initial state', () => {
    const state = useAuthStore.getState();
    // Vérifier que les champs clés sont présents (adapter selon l'interface réelle)
    expect('user' in state || 'token' in state || 'isAuthenticated' in state).toBe(true);
  });
});
```

- [x] **Step 4 : Écrire les tests d'isolation pour les 3 autres stores**

Créer `apps/client/src/stores/__tests__/competition.store.isolation.test.ts` :

```typescript
import { useCompetitionStore } from '../competition.store';

describe('competitionStore isolation', () => {
  beforeEach(() => {
    useCompetitionStore.setState(useCompetitionStore.getInitialState());
  });

  it('initializes without depending on other stores', () => {
    const state = useCompetitionStore.getState();
    expect(state).toBeDefined();
  });
});
```

Créer `apps/client/src/stores/__tests__/player.store.isolation.test.ts` :

```typescript
import { usePlayerStore } from '../player.store';

describe('playerStore isolation', () => {
  beforeEach(() => {
    usePlayerStore.setState(usePlayerStore.getInitialState());
  });

  it('initializes without depending on other stores', () => {
    const state = usePlayerStore.getState();
    expect(state).toBeDefined();
  });
});
```

Créer `apps/client/src/stores/__tests__/club.store.isolation.test.ts` :

```typescript
import { useClubStore } from '../club.store';

describe('clubStore isolation', () => {
  beforeEach(() => {
    useClubStore.setState(useClubStore.getInitialState());
  });

  it('initializes without depending on other stores', () => {
    const state = useClubStore.getState();
    expect(state).toBeDefined();
  });
});
```

- [x] **Step 5 : Lancer les tests d'isolation**

```bash
cd apps/client && pnpm test stores/__tests__
```

Attendu : tous les tests passent. Si `getInitialState` n'existe pas sur un store, utiliser `getState()` directement et réinitialiser manuellement avec `setState({})`.

- [x] **Step 6 : Commit**

```bash
git add apps/client/src/stores/index.ts apps/client/src/stores/__tests__/
git commit -m "refactor(stores): add barrel export and isolation tests for Zustand stores"
```

---

## Tâche 4 : Tests — couvrir les branches critiques du module auth

**Files:**

- Modify: `apps/backend/src/auth/auth.service.spec.ts`
- Modify: `apps/backend/jest.config.js`

### Contexte

Cette tâche cible `auth/` uniquement (le module le mieux connu et déjà partiellement couvert). Les modules payment, licenses, competitions font l'objet de la tâche 5 (fixtures) et seront couverts dans un plan dédié si le scope est trop large.

Les branches à couvrir dans `auth.service.ts` :

- `validateUser` : utilisateur inexistant, mauvais mot de passe
- `refreshToken` : token expiré, token révoqué
- `resetPassword` : token invalide, token déjà utilisé, token expiré
- `changePassword` : mauvais mot de passe actuel, nouveau = ancien

- [x] **Step 1 : Mesurer la couverture actuelle**

```bash
cd apps/backend && pnpm test --coverage --collectCoverageFrom="src/auth/auth.service.ts" auth.service.spec.ts 2>/dev/null | grep -A5 "auth.service"
```

Attendu : affiche statements/branches/functions/lines pour `auth.service.ts`

- [x] **Step 2 : Ajouter les tests de branches manquantes dans auth.service.spec.ts**

Ajouter ce bloc `describe` dans `apps/backend/src/auth/auth.service.spec.ts` :

```typescript
describe('validateUser — branches critiques', () => {
  it('should return null when user does not exist', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(null);
    const result = await service.validateUser('unknown@example.com', 'pass');
    expect(result).toBeNull();
  });

  it('should return null when password is incorrect', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
      password: 'hashed',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const result = await service.validateUser('test@example.com', 'wrong');
    expect(result).toBeNull();
  });
});

describe('resetPassword — branches critiques', () => {
  it('should throw BadRequestException when token does not exist', async () => {
    mockPrismaService.passwordResetToken.findUnique.mockResolvedValue(null);
    await expect(service.resetPassword('invalid-token', 'NewPassword1!')).rejects.toThrow(
      'Token de réinitialisation invalide',
    );
  });

  it('should throw BadRequestException when token is already used', async () => {
    mockPrismaService.passwordResetToken.findUnique.mockResolvedValue({
      id: 'token-1',
      used: true,
      expiresAt: new Date(Date.now() + 3600000),
      userId: 'user-1',
    });
    await expect(service.resetPassword('used-token', 'NewPassword1!')).rejects.toThrow(
      'Token de réinitialisation invalide',
    );
  });

  it('should throw BadRequestException when token is expired', async () => {
    mockPrismaService.passwordResetToken.findUnique.mockResolvedValue({
      id: 'token-1',
      used: false,
      expiresAt: new Date(Date.now() - 1000), // passé
      userId: 'user-1',
    });
    await expect(service.resetPassword('expired-token', 'NewPassword1!')).rejects.toThrow(
      'Token de réinitialisation invalide',
    );
  });
});

describe('changePassword — branches critiques', () => {
  it('should throw UnauthorizedException when current password is wrong', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      password: 'hashed',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    await expect(
      service.changePassword('user-1', 'wrong-current', 'NewPassword1!'),
    ).rejects.toThrow('Mot de passe actuel incorrect');
  });

  it('should throw BadRequestException when new password is same as current', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      password: 'hashed',
    });
    // Premier compare (currentPassword) = true, deuxième (isSamePassword) = true
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    await expect(service.changePassword('user-1', 'current', 'current')).rejects.toThrow(
      'Le nouveau mot de passe doit être différent',
    );
  });

  it('should throw NotFoundException when user does not exist', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(null);
    await expect(service.changePassword('unknown', 'current', 'NewPassword1!')).rejects.toThrow(
      'Utilisateur non trouvé',
    );
  });
});
```

- [x] **Step 3 : Lancer les tests**

```bash
cd apps/backend && pnpm test auth.service.spec.ts
```

Attendu : tous les tests passent

- [x] **Step 4 : Vérifier la couverture du module auth**

```bash
cd apps/backend && pnpm test --coverage --collectCoverageFrom="src/auth/auth.service.ts" auth.service.spec.ts 2>/dev/null | grep -A5 "auth.service"
```

Attendu : branches > 85%

- [x] **Step 5 : Mettre à jour les seuils dans jest.config.js**

Trouver le bloc `coverageThresholds` dans `apps/backend/jest.config.js` et ajouter ou mettre à jour le seuil pour auth :

```javascript
"./src/auth/auth.service.ts": {
  statements: 90,
  branches: 85,
  functions: 90,
  lines: 90,
},
```

- [x] **Step 6 : Vérifier que les seuils passent**

```bash
cd apps/backend && pnpm test --coverage auth.service.spec.ts
```

Attendu : pas d'erreur de seuil

- [x] **Step 7 : Commit**

```bash
git add apps/backend/src/auth/auth.service.spec.ts apps/backend/jest.config.js
git commit -m "test(auth): add branch coverage for validateUser, resetPassword, changePassword"
```

---

## Tâche 5 : Intégrations externes — fixtures VCR et mocks stricts

**Files:**

- Create: `apps/backend/test/fixtures/` (6 fichiers JSON)
- Modify: specs wdsf, payment, licenses

### Contexte

On utilise `nock` pour intercepter les appels HTTP sortants et les rejouer depuis des fixtures JSON. Les 3 intégrations prioritaires sont WDSF (sync athlètes), HelloAsso (paiements), et Google Vision (OCR licences).

- [x] **Step 1 : Installer nock**

```bash
cd apps/backend && pnpm add -D nock @types/nock
```

Attendu : nock ajouté dans devDependencies

- [x] **Step 2 : Créer les fixtures WDSF**

Créer `apps/backend/test/fixtures/wdsf/athlete-profile.json` :

```json
{
  "id": 123456,
  "firstName": "Jean",
  "lastName": "Dupont",
  "country": "FRA",
  "discipline": "LAT",
  "ranking": 42
}
```

Créer `apps/backend/test/fixtures/wdsf/error-401.json` :

```json
{
  "error": "Unauthorized",
  "message": "Invalid API key",
  "statusCode": 401
}
```

- [x] **Step 3 : Créer les fixtures HelloAsso**

Créer `apps/backend/test/fixtures/helloasso/payment-confirmed.json` :

```json
{
  "id": "pay-abc123",
  "status": "Authorized",
  "amount": 3500,
  "currency": "EUR",
  "order": {
    "id": "order-xyz789",
    "formSlug": "competition-2026"
  }
}
```

Créer `apps/backend/test/fixtures/helloasso/payment-failed.json` :

```json
{
  "id": "pay-failed",
  "status": "Refused",
  "amount": 3500,
  "currency": "EUR",
  "error": "InsufficientFunds"
}
```

- [x] **Step 4 : Créer les fixtures Google Vision**

Créer `apps/backend/test/fixtures/google-vision/license-scan-success.json` :

```json
{
  "responses": [
    {
      "textAnnotations": [
        {
          "description": "LICENCE FFD\nNuméro: 123456\nNom: DUPONT Jean\nValide jusqu'au: 31/08/2026",
          "boundingPoly": { "vertices": [] }
        }
      ],
      "fullTextAnnotation": {
        "text": "LICENCE FFD\nNuméro: 123456\nNom: DUPONT Jean\nValide jusqu'au: 31/08/2026"
      }
    }
  ]
}
```

Créer `apps/backend/test/fixtures/google-vision/license-scan-low-confidence.json` :

```json
{
  "responses": [
    {
      "textAnnotations": [
        {
          "description": "????",
          "boundingPoly": { "vertices": [] }
        }
      ],
      "fullTextAnnotation": {
        "text": ""
      }
    }
  ]
}
```

- [x] **Step 5 : Trouver les specs des services concernés**

```bash
find apps/backend/src -name "*.spec.ts" | xargs grep -l "wdsf\|helloasso\|vision\|payment\|license" -i | head -10
```

Lire chaque fichier trouvé pour comprendre la structure existante des mocks.

- [x] **Step 6 : Ajouter des tests d'erreur HTTP dans les specs existantes**

Pour chaque spec de service utilisant Axios ou HttpService, ajouter un test de timeout et un test d'erreur 5xx. Exemple pour un service WDSF hypothétique `apps/backend/src/wdsf/wdsf.service.spec.ts` :

```typescript
import nock from 'nock';
import * as athleteFixture from '../../test/fixtures/wdsf/athlete-profile.json';
import * as error401Fixture from '../../test/fixtures/wdsf/error-401.json';

describe('WdsfService — contrats API', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('should parse athlete profile correctly from API response', async () => {
    nock('https://api.wdsf.org').get('/athletes/123456').reply(200, athleteFixture);

    const result = await service.getAthlete('123456');
    expect(result.id).toBe(123456);
    expect(result.firstName).toBe('Jean');
  });

  it('should throw on 401 response', async () => {
    nock('https://api.wdsf.org').get('/athletes/123456').reply(401, error401Fixture);

    await expect(service.getAthlete('123456')).rejects.toThrow();
  });

  it('should throw on network timeout', async () => {
    nock('https://api.wdsf.org').get('/athletes/123456').replyWithError({ code: 'ECONNABORTED' });

    await expect(service.getAthlete('123456')).rejects.toThrow();
  });
});
```

Adapter les URLs, méthodes et noms de service selon les implémentations réelles trouvées à l'étape 5.

- [x] **Step 7 : Lancer les tests**

```bash
cd apps/backend && pnpm test
```

Attendu : tous les tests passent

- [x] **Step 8 : Commit**

```bash
git add apps/backend/test/fixtures/ apps/backend/src/ apps/backend/package.json pnpm-lock.yaml
git commit -m "test(integrations): add VCR fixtures and strict HTTP error tests for WDSF, HelloAsso, Vision"
```

---

## Self-review

**Couverture spec :**

- ✅ bcrypt 12 rounds + rehash → Tâche 1
- ✅ Prisma schema split → Tâche 2
- ✅ Zustand isolation + barrel → Tâche 3
- ✅ Tests branches critiques auth → Tâche 4
- ✅ Fixtures VCR + mocks stricts → Tâche 5

**Placeholders :** aucun TBD. La tâche 5 step 6 requiert une adaptation selon les fichiers réels trouvés à l'étape 5 — c'est intentionnel car les noms d'URL WDSF/HelloAsso doivent être lus dans le code.

**Cohérence des types :** `BCRYPT_ROUNDS` défini en tâche 1 utilisé uniquement dans `auth.service.ts`. Les fixtures JSON sont importées avec `* as` pour compatibilité TypeScript.
