# Guide des Bonnes Pratiques pour les Tests - FFD Connect

**Dernière mise à jour** : 10 février 2026

Ce guide documente les bonnes pratiques et patterns utilisés dans le projet pour écrire des tests maintenables et efficaces.

---

## 📋 Table des Matières

1. [Patterns React Native](#patterns-react-native)
2. [Patterns Backend (NestJS)](#patterns-backend-nestjs)
3. [Gestion des Tests Asynchrones](#gestion-des-tests-asynchrones)
4. [Mocking](#mocking)
5. [Gestion des Erreurs](#gestion-des-erreurs)
6. [Optimisation des Performances](#optimisation-des-performances)

---

## 🎯 Patterns React Native

### 1. Utilisation de `act()` pour les Mises à Jour d'État

**Problème** : React avertit lorsque des mises à jour d'état ne sont pas wrappées dans `act()`.

**Solution** : Toujours wrapper les opérations asynchrones et les mises à jour d'état dans `act()`.

```typescript
// ❌ Mauvais
it('should update state', async () => {
  const { result } = renderHook(() => useMyHook());
  await result.current.loadData(); // Peut causer un avertissement
  expect(result.current.data).toBeTruthy();
});

// ✅ Bon
it('should update state', async () => {
  const { result } = renderHook(() => useMyHook());
  await act(async () => {
    await result.current.loadData();
  });
  expect(result.current.data).toBeTruthy();
});
```

### 2. Combinaison `act()` + `waitFor()`

Pour les opérations asynchrones avec attente :

```typescript
// ✅ Bon
await act(async () => {
  await waitFor(() => {
    expect(mockFunction).toHaveBeenCalled();
  });
});

await act(async () => {
  await waitFor(() => {
    expect(getByText('Expected Text')).toBeTruthy();
  });
});
```

### 3. Gestion des Timers avec `act()`

Pour les tests utilisant `jest.useFakeTimers()` :

```typescript
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  act(() => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

it('should update on timer', () => {
  const { result } = renderHook(() => useMyHook());

  act(() => {
    jest.advanceTimersByTime(1000);
  });

  expect(result.current.value).toBe(expectedValue);
});
```

### 4. Mocking de `react-native`

Pour éviter les problèmes avec TurboModuleRegistry :

```typescript
jest.mock('react-native', () => {
  return {
    ...jest.requireActual('react-native/jest/mock'),
    Alert: {
      alert: jest.fn((title, message, buttons) => {
        // Implémentation du mock
      }),
    },
    Platform: {
      OS: 'ios',
      Version: '17.0',
      select: (options: Record<string, any>) => options.ios ?? options.default ?? options,
    },
  };
});
```

---

## 🔧 Patterns Backend (NestJS)

### 1. Structure des Tests de Service

```typescript
describe('MyService', () => {
  let service: MyService;
  let mockRepository: jest.Mocked<MyRepository>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MyService,
        {
          provide: MyRepository,
          useValue: {
            find: jest.fn(),
            create: jest.fn(),
            // ... autres méthodes
          },
        },
      ],
    }).compile();

    service = module.get<MyService>(MyService);
    mockRepository = module.get(MyRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should do something', async () => {
    mockRepository.find.mockResolvedValue(mockData);

    const result = await service.doSomething();

    expect(result).toEqual(expectedResult);
    expect(mockRepository.find).toHaveBeenCalledWith(expectedArgs);
  });
});
```

### 2. Tests de Contrôleurs avec Validation

```typescript
describe('MyController', () => {
  let controller: MyController;
  let service: jest.Mocked<MyService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [MyController],
      providers: [
        {
          provide: MyService,
          useValue: {
            create: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<MyController>(MyController);
    service = module.get(MyService);
  });

  it('should return 400 on invalid input', async () => {
    const invalidDto = {
      /* données invalides */
    };

    await expect(controller.create(invalidDto)).rejects.toThrow(BadRequestException);
  });
});
```

---

## ⏱️ Gestion des Tests Asynchrones

### 1. Timeouts Personnalisés

Pour les tests qui peuvent prendre plus de temps :

```typescript
it('should handle slow operation', async () => {
  // ... test code
}, 10000); // 10 secondes de timeout
```

### 2. `waitFor()` avec Options

```typescript
await waitFor(
  () => {
    expect(something).toBeTruthy();
  },
  {
    timeout: 3000, // Timeout personnalisé
    interval: 100, // Intervalle de vérification
  },
);
```

### 3. Nettoyage des Opérations Asynchrones

```typescript
afterEach(() => {
  // Nettoyer les timers
  act(() => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();

  // Nettoyer les mocks
  jest.clearAllMocks();

  // Nettoyer les subscriptions
  // (si applicable)
});
```

---

## 🎭 Mocking

### 1. Mocking des Services Externes

```typescript
// Mock d'un service externe
jest.mock('../services/ExternalService', () => ({
  ExternalService: {
    fetchData: jest.fn().mockResolvedValue(mockData),
    uploadFile: jest.fn().mockResolvedValue({ success: true }),
  },
}));
```

### 2. Mocking des Hooks React Native

```typescript
jest.mock('../../context/MyContext', () => ({
  useMyContext: jest.fn(() => ({
    data: mockData,
    actions: {
      doSomething: jest.fn(),
    },
  })),
}));
```

### 3. Mocking des Modules Natifs

```typescript
jest.mock('react-native-fs', () => ({
  downloadFile: jest.fn().mockReturnValue({
    promise: Promise.resolve({ statusCode: 200 }),
  }),
  DocumentDirectoryPath: '/test/path',
}));
```

### 4. Mocking Conditionnel

```typescript
const mockFunction = jest.fn();

// Pour différents scénarios
mockFunction
  .mockResolvedValueOnce(successData)
  .mockRejectedValueOnce(new Error('Error'))
  .mockResolvedValueOnce(anotherData);
```

---

## 🚨 Gestion des Erreurs

### 1. Tests d'Erreurs Attendues

```typescript
it('should handle errors gracefully', async () => {
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

  mockService.fetch.mockRejectedValue(new Error('Network error'));

  await expect(service.doSomething()).rejects.toThrow('Network error');

  consoleErrorSpy.mockRestore();
});
```

### 2. Filtrage des Erreurs Attendues

Les erreurs attendues dans les tests sont automatiquement filtrées par `jest.setup.js` :

```javascript
const knownTestErrors = [
  'yt-dlp error',
  'Network error',
  'API Error',
  // ... autres erreurs attendues
];
```

### 3. Tests d'Erreurs avec Messages Spécifiques

```typescript
it('should throw specific error', async () => {
  await expect(service.doSomething()).rejects.toThrow('Expected error message');
});
```

---

## ⚡ Optimisation des Performances

### 1. Utilisation de `maxWorkers`

Déjà configuré dans `jest.config.js` :

```javascript
maxWorkers: '50%', // Utilise 50% des CPU disponibles
```

### 2. Cache Jest

Le cache Jest est activé pour accélérer les relances :

```javascript
cacheDirectory: '<rootDir>/../.jest-cache',
```

### 3. Tests en Parallèle

Par défaut, Jest exécute les tests en parallèle. Pour les tests qui doivent être séquentiels :

```typescript
describe.sequential('Sequential tests', () => {
  // Tests qui doivent s'exécuter dans l'ordre
});
```

### 4. Éviter les Tests Lents

- Utiliser des mocks plutôt que de vraies opérations I/O
- Limiter les timeouts au strict nécessaire
- Éviter les `sleep()` ou `setTimeout()` longs

---

## 📝 Checklist pour Nouveaux Tests

Avant de créer un nouveau test, vérifier :

- [ ] Le test est isolé (pas de dépendances entre tests)
- [ ] Toutes les dépendances sont mockées
- [ ] Les opérations asynchrones sont wrappées dans `act()`
- [ ] Les timers sont nettoyés dans `afterEach`
- [ ] Les mocks sont réinitialisés dans `beforeEach`
- [ ] Les erreurs attendues sont gérées proprement
- [ ] Le test a un nom descriptif
- [ ] Le test vérifie un comportement spécifique
- [ ] Le test peut échouer (pas de test qui passe toujours)

---

## 🔍 Debugging des Tests

### Mode Verbose

Pour voir tous les logs pendant le debug :

```bash
JEST_SILENT=false pnpm test
```

### Tests Individuels

Pour exécuter un seul test :

```bash
pnpm test MyTest.test.tsx -t "should do something"
```

### Coverage d'un Fichier Spécifique

```bash
pnpm test:cov --collectCoverageFrom="src/services/MyService.ts"
```

### Détection des Fuites

Pour détecter les handles ouverts :

```bash
pnpm test --detectOpenHandles
```

---

## 📚 Ressources

- [React Testing Library](https://testing-library.com/react-native)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
- [Maestro E2E Testing](https://maestro.mobile.dev/)

---

## 🎓 Exemples Concrets

### Exemple Complet : Test de Hook

```typescript
import { act, renderHook, waitFor } from '@testing-library/react-native';

describe('useMyHook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should load data on mount', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ data: 'test' });

    const { result } = renderHook(() => useMyHook());

    await act(async () => {
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });
    });

    await act(async () => {
      await waitFor(() => {
        expect(result.current.data).toBe('test');
      });
    });
  });
});
```

### Exemple Complet : Test de Service

```typescript
describe('MyService', () => {
  let service: MyService;
  let mockRepo: jest.Mocked<MyRepository>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MyService,
        {
          provide: MyRepository,
          useValue: {
            find: jest.fn(),
            create: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(MyService);
    mockRepo = module.get(MyRepository);
  });

  it('should create and return entity', async () => {
    const input = { name: 'Test' };
    const expected = { id: 1, ...input };

    mockRepo.create.mockResolvedValue(expected);

    const result = await service.create(input);

    expect(result).toEqual(expected);
    expect(mockRepo.create).toHaveBeenCalledWith(input);
  });
});
```

---

## ✅ Conclusion

En suivant ces bonnes pratiques, vous garantissez :

- ✅ Des tests maintenables et lisibles
- ✅ Des tests rapides et efficaces
- ✅ Des tests fiables et isolés
- ✅ Une meilleure expérience de développement

Pour toute question ou suggestion d'amélioration, consultez l'équipe ou ouvrez une issue.
