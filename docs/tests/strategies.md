# Stratégies de Test - FFD Connect

Ce document décrit les stratégies de test utilisées dans le projet FFD Connect.

## Vue d'Ensemble

Le projet utilise une approche de tests en couches avec différents types de tests pour garantir la qualité du code.

## Types de Tests

### 1. Tests Unitaires

**Objectif:** Tester des unités de code isolées (fonctions, méthodes, classes).

**Outils:**

- Jest (backend et mobile)
- React Testing Library (mobile)

**Exemple Backend:**

```typescript
describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;

  beforeEach(() => {
    const module = await Test.createTestingModule({
      providers: [AuthService, PrismaService],
    }).compile();
    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should validate user credentials', async () => {
    const user = { email: 'test@example.com', password: 'hashed' };
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(user);

    const result = await service.validateUser('test@example.com', 'password');
    expect(result).toBeDefined();
  });
});
```

**Exemple Mobile:**

```typescript
describe('useCompetitionsLogic', () => {
  it('should fetch competitions', async () => {
    const { result } = renderHook(() => useCompetitionsLogic());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.competitions).toHaveLength(5);
  });
});
```

### 2. Tests d'Intégration

**Objectif:** Tester l'interaction entre plusieurs composants.

**Exemple Backend:**

```typescript
describe('AuthController (integration)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  it('POST /auth/login should return token', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'password' })
      .expect(200)
      .expect((res) => {
        expect(res.body.access_token).toBeDefined();
      });
  });
});
```

### 3. Tests E2E (End-to-End)

**Objectif:** Tester des scénarios complets depuis l'interface utilisateur jusqu'à la base de données.

**Backend:**

- Utilise Jest avec Supertest
- Tests dans `test/` directory

**Mobile:**

- Utilise Maestro pour les tests E2E
- Tests dans `.maestro/` directory

**Exemple Backend E2E:**

```typescript
describe('Competitions E2E', () => {
  it('should create a competition', async () => {
    const token = await getAuthToken();

    const response = await request(app.getHttpServer())
      .post('/competitions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Test Competition',
        date: '2026-03-01',
        location: 'Paris',
      })
      .expect(201);

    expect(response.body.id).toBeDefined();
  });
});
```

### 4. Tests de Composants (Mobile)

**Objectif:** Tester le rendu et l'interaction des composants React Native.

**Exemple:**

```typescript
describe('CompetitionCard', () => {
  it('should render competition details', () => {
    const competition = {
      id: '1',
      title: 'Test Competition',
      date: '2026-03-01',
      location: 'Paris',
    };

    const { getByText } = render(<CompetitionCard competition={competition} />);

    expect(getByText('Test Competition')).toBeTruthy();
    expect(getByText('Paris')).toBeTruthy();
  });

  it('should call onPress when pressed', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <CompetitionCard competition={competition} onPress={onPress} />
    );

    fireEvent.press(getByText('Test Competition'));
    expect(onPress).toHaveBeenCalled();
  });
});
```

## Structure des Tests

### Backend

```
apps/backend/
├── src/
│   ├── auth/
│   │   ├── auth.service.spec.ts      # Tests unitaires
│   │   └── auth.controller.spec.ts   # Tests unitaires
│   └── ...
└── test/
    ├── auth.e2e-spec.ts              # Tests E2E
    └── ...
```

### Client (Expo/React Native)

```
apps/client/
├── src/
│   ├── components/
│   │   └── __tests__/
│   │       └── CompetitionCard.test.tsx
│   ├── hooks/
│   │   └── __tests__/
│   │       └── useCompetitionsLogic.test.tsx
│   └── screens/
│       └── __tests__/
│           └── CompetitionsScreen.test.tsx
└── .maestro/
    └── flows/
        └── login.flow.yaml            # Tests E2E Maestro
```

## Configuration Jest

### Backend

```javascript
// jest.config.js
module.exports = {
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 70,
      functions: 90,
      lines: 90,
    },
  },
};
```

### Mobile

```javascript
// jest.config.js
module.exports = {
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 70,
      functions: 60,
      lines: 85,
    },
  },
};
```

## Stratégies de Mock

### Backend

**Mock Prisma:**

```typescript
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};
```

**Mock Services:**

```typescript
const mockJwtService = {
  sign: jest.fn().mockReturnValue('token'),
};
```

### Mobile

**Mock API:**

```typescript
jest.mock('../services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));
```

**Mock Navigation:**

```typescript
const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
};
```

## Bonnes Pratiques

### 1. Nommage des Tests

- ✅ `should validate user credentials`
- ✅ `should return error when user not found`
- ❌ `test1`
- ❌ `works`

### 2. Structure AAA (Arrange, Act, Assert)

```typescript
it('should login user', async () => {
  // Arrange
  const email = 'test@example.com';
  const password = 'password';

  // Act
  const result = await authService.login(email, password);

  // Assert
  expect(result.access_token).toBeDefined();
});
```

### 3. Tests Isolés

Chaque test doit être indépendant :

- ✅ Utiliser `beforeEach` pour réinitialiser l'état
- ✅ Nettoyer les mocks après chaque test
- ❌ Dépendre d'autres tests

### 4. Couverture de Code

Objectifs de couverture :

- **Backend:** 90% statements, 70% branches
- **Mobile:** 85% statements, 70% branches

### 5. Tests Rapides

- ✅ Tests unitaires doivent être rapides (< 100ms)
- ✅ Utiliser des mocks pour les dépendances externes
- ❌ Faire des appels réseau réels dans les tests unitaires

## Tests de Performance

### Backend

```typescript
it('should respond within 100ms', async () => {
  const start = Date.now();
  await service.getCompetitions();
  const duration = Date.now() - start;
  expect(duration).toBeLessThan(100);
});
```

### Mobile

```typescript
it('should render list within 500ms', async () => {
  const start = Date.now();
  render(<CompetitionsScreen />);
  await waitFor(() => {
    expect(screen.getByText('Competition 1')).toBeTruthy();
  });
  const duration = Date.now() - start;
  expect(duration).toBeLessThan(500);
});
```

## Tests de Charge

Pour les tests de charge, utiliser des outils externes :

- **Artillery** pour les tests de charge API
- **k6** pour les tests de performance

## CI/CD

Les tests sont exécutés automatiquement dans la CI :

- Tests unitaires sur chaque commit
- Tests E2E sur les pull requests
- Vérification de la couverture de code

## Commandes

### Backend

```bash
# Tests unitaires
pnpm test

# Tests en mode watch
pnpm test:watch

# Tests avec couverture
pnpm test:cov

# Tests E2E
pnpm test:e2e
```

### Mobile

```bash
# Tests unitaires
pnpm test

# Tests avec couverture
pnpm test:cov

# Tests E2E avec Maestro
pnpm test:e2e
```

## Améliorations pragmatiques (sans overtesting)

Principes : ajouter des tests qui **évitent des régressions** ou **documentent un comportement critique**, sans viser 100 % de couverture ni tester l’évident.

### Règle d’or

- **Tester** : comportement dont un changement casserait l’app (auth, mutations, règles métier, parcours critiques).
- **Ne pas tester** : détails d’implémentation, getters/setters triviaux, code tiers, branches “défensives” sans logique métier.

### Backend

| Action                                                                                                                                                                                                                                                                                                    | Effort    | Bénéfice                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------- |
| **Documenter la stratégie E2E** : dans `apps/backend/test/README.md` (ou en en-tête de `strategies.md`), indiquer quels E2E utilisent une **vraie DB** (ex. `competitions.e2e-spec.ts`) et lesquels **mockent Prisma** (ex. `auth.e2e-spec.ts`). Prérequis : Postgres + `DATABASE_URL` pour les premiers. | Faible    | Évite les surprises en CI / en local et clarifie quand lancer quoi. |
| **Ne pas ajouter de tests** pour “remonter” la couverture sur du code déjà couvert par un E2E ou par un test unitaire voisin. Utiliser la couverture pour **repérer** le code à risque non couvert, pas comme objectif à atteindre à tout prix.                                                           | Nul       | Évite l’overtesting.                                                |
| **Nouvelle route / mutation** : au minimum 1 test unitaire (service ou controller) pour le cas nominal + 1 pour l’erreur principale. E2E uniquement si le flux est critique (auth, compétitions, rapports).                                                                                               | Récurrent | Bon rapport coût / valeur.                                          |

### Client

| Action                                                                                                                                                                                                                                                                                                          | Effort | Bénéfice                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------ |
| **Centraliser les mocks communs** : theme, navigation, `AuthRepository` (déjà partiellement dans `test-utils.tsx`). Exposer par exemple `mockTheme`, `mockNavigation`, `createMockAuthRepository()` depuis `test-utils` ou `__tests__/mocks/` pour que les tests d’écrans ne redéfinissent pas les mêmes mocks. | Moyen  | Moins de duplication, refactors plus simples.          |
| **1–2 tests “intégration légère”** : un écran critique (ex. Login ou CompetitionDetail) rendu avec `renderWithProviders` et le **vrai** hook (pas mocké), en mockant uniquement l’API (ex. `api.post`). Un seul test par écran suffit pour valider le câblage.                                                  | Moyen  | Détecte les erreurs de wiring sans passer par Maestro. |
| **Branches à 74 %** : garder le seuil actuel ou le monter progressivement. Ne pas forcer 80 % en testant chaque branche de la navigation ou de l’UI secondaire.                                                                                                                                                 | Nul    | Évite des tests fragiles sur du code peu critique.     |

### Quand ajouter un test (checklist mentale)

- Nouvelle **règle métier** ou **validation** → test unitaire (service ou hook).
- Nouvelle **route API** ou **mutation** → au moins 1 test unitaire (nominal + erreur principale) ; E2E seulement si flux critique.
- Nouveau **écran** → 1 test de rendu (avec mocks) ; optionnel : 1 test “intégration légère” avec vrai hook si écran critique.
- Changement **cosmétique** ou **texte** → pas de test obligatoire.
- Bug corrigé → **1 test qui aurait pu éviter le bug** (régression ciblée), pas une batterie de tests.

### Ce qu’on évite (overtesting)

- Tests qui vérifient des détails d’implémentation (noms de méthodes internes, ordre d’appels non contractuels).
- Snapshots sur de gros arbres de composants (fragiles, peu lisibles).
- Tests unitaires sur des wrappers minces autour de librairies (ex. “appelle bien lib X”) sauf si la logique de configuration est subtile.
- Doublons : même scénario testé en unitaire + E2E + Maestro sans valeur ajoutée.

---

## Ressources

- [Jest Documentation](https://jestjs.io/)
- [React Testing Library](https://testing-library.com/react-native)
- [Maestro Documentation](https://maestro.mobile.dev/)

---

**Dernière mise à jour:** 23 Février 2026
