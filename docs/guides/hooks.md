# Documentation des Hooks

Cette documentation décrit tous les hooks personnalisés disponibles dans l'application mobile FFD Connect.

## Table des matières

### Hooks utilitaires (src/hooks/)

- [useAsync](#useasync) - Gestion des opérations asynchrones
- [useBackendHealth](#usebackendhealth) - Vérification de la santé du backend
- [useErrorHandler](#useerrorhandler) - Gestion centralisée des erreurs
- [useLoadingState](#useloadingstate) - Gestion de l'état de chargement

### Hooks métier (src/features/)

Les hooks métier sont organisés par domaine métier et documentés dans leurs modules respectifs :

#### Hooks de compétitions (`src/features/competitions/hooks/`)

- `useCompetitionDetailLogic` - Logique de détail des compétitions (inscription/désinscription, affichage des événements)
- `useCompetitionsLogic` - Logique de liste des compétitions (filtrage, recherche)
- `useLiveTiming` - Gestion du timing en direct des compétitions (WebSocket, mises à jour temps réel)

#### Hooks de licence (`src/features/license/hooks/`)

- `useLicenseLogic` - Gestion de la logique des licences (affichage cartes, génération PDF, vérification WDSF, QR codes)
- `useScannerLogic` - Logique de scan QR code pour les licences

#### Hooks de club (`src/features/club/hooks/`)

- `useClubCompetitionEditorLogic` - Édition des compétitions de club (création, modification)
- `useClubMembersLogic` - Gestion des membres du club (liste, ajout, modification)

#### Hooks de player (`src/features/player/hooks/`)

- `useAudioPlayerLogic` - Logique de lecture audio (playback, contrôle)
- `useLibraryLogic` - Gestion de la bibliothèque de musiques

#### Hooks de settings (`src/features/settings/hooks/`)

- `useSettingsLogic` - Logique des paramètres utilisateur
- `useNotificationsLogic` - Gestion des notifications
- `useNotificationsRepository` - Repository pour les notifications

Pour plus de détails sur chaque hook métier, consultez les fichiers sources dans `src/features/[domain]/hooks/`.

---

## useAsync

Hook utilitaire pour gérer les opérations asynchrones avec un état unifié (data, loading, error).

### Signature

```typescript
function useAsync<T, P extends any[] = []>(
  asyncFunction: (...args: P) => Promise<T>,
  options?: UseAsyncOptions,
): AsyncState<T> & { execute: (...args: P) => Promise<T | null> };
```

### Paramètres

- `asyncFunction`: Fonction asynchrone à exécuter
- `options`: Options optionnelles
  - `resetOnExecute` (boolean): Si `true`, réinitialise l'état avant chaque exécution
  - `onSuccess` (function): Callback appelé en cas de succès
  - `onError` (function): Callback appelé en cas d'erreur

### Retour

- `data`: Données retournées par la fonction asynchrone (ou `null`)
- `loading`: État de chargement (`boolean`)
- `error`: Erreur éventuelle (`Error | null`)
- `execute`: Fonction pour déclencher l'opération asynchrone

### Exemples d'utilisation

#### Utilisation basique

```typescript
import { useAsync } from '../hooks/useAsync';

const MyComponent = () => {
  const { data, loading, error, execute } = useAsync(async () => {
    const response = await fetch('/api/data');
    return response.json();
  });

  useEffect(() => {
    execute();
  }, []);

  if (loading) return <Text>Chargement...</Text>;
  if (error) return <Text>Erreur: {error.message}</Text>;
  return <Text>{JSON.stringify(data)}</Text>;
};
```

#### Avec options et callbacks

```typescript
const { data, loading, error, execute } = useAsync(
  async (userId: string) => {
    const response = await fetch(`/api/users/${userId}`);
    return response.json();
  },
  {
    resetOnExecute: true,
    onSuccess: (data) => {
      console.log('Données récupérées:', data);
    },
    onError: (error) => {
      console.error('Erreur:', error);
    },
  },
);

// Exécuter avec des paramètres
execute('user-123');
```

#### Avec paramètres dynamiques

```typescript
const { data, loading, error, execute } = useAsync(
  async (competitionId: string, eventId: string) => {
    return competitionsService.getEventDetails(competitionId, eventId);
  },
);

// Utilisation
const handleViewEvent = (competitionId: string, eventId: string) => {
  execute(competitionId, eventId);
};
```

---

## useBackendHealth

Hook pour vérifier la santé du backend et sa disponibilité.

### Signature

```typescript
function useBackendHealth(): { checkHealth: () => Promise<boolean> };
```

### Retour

- `checkHealth`: Fonction asynchrone qui retourne `true` si le backend est accessible, `false` sinon

### Exemples d'utilisation

#### Vérification simple

```typescript
import { useBackendHealth } from '../hooks/useBackendHealth';

const MyComponent = () => {
  const { checkHealth } = useBackendHealth();

  const handleCheck = async () => {
    const isHealthy = await checkHealth();
    if (isHealthy) {
      console.log('Backend opérationnel');
    } else {
      console.log('Backend non accessible');
    }
  };

  return <Button onPress={handleCheck} title="Vérifier le backend" />;
};
```

#### Vérification périodique

```typescript
useEffect(() => {
  const interval = setInterval(async () => {
    const isHealthy = await checkHealth();
    if (!isHealthy) {
      Alert.alert('Attention', "Le backend n'est pas accessible");
    }
  }, 30000); // Vérifie toutes les 30 secondes

  return () => clearInterval(interval);
}, [checkHealth]);
```

---

## useErrorHandler

Hook pour gérer les erreurs de manière cohérente dans toute l'application.

### Signature

```typescript
function useErrorHandler(): {
  handleError: (error: unknown, options?: ErrorHandlerOptions) => void;
  withErrorHandling: <T>(fn: () => Promise<T>, options?: ErrorHandlerOptions) => Promise<T | null>;
  withLoadingAndErrorHandling: <T>(
    fn: () => Promise<T>,
    setLoading: (loading: boolean) => void,
    options?: ErrorHandlerOptions,
  ) => Promise<T | null>;
};
```

### Options

- `userMessage` (string): Message d'erreur personnalisé à afficher
- `logError` (boolean): Si `true`, log l'erreur dans la console (défaut: `true`)
- `showAlert` (boolean): Si `true`, affiche une alerte à l'utilisateur (défaut: `false`)
- `onError` (function): Callback appelé en cas d'erreur

### Retour

- `handleError`: Fonction pour gérer une erreur manuellement
- `withErrorHandling`: Wrapper pour exécuter une fonction avec gestion automatique des erreurs
- `withLoadingAndErrorHandling`: Wrapper combinant gestion d'erreur et état de chargement

### Exemples d'utilisation

#### Gestion manuelle d'erreur

```typescript
import { useErrorHandler } from '../hooks/useErrorHandler';

const MyComponent = () => {
  const { handleError } = useErrorHandler();

  const handleAction = async () => {
    try {
      await someAsyncOperation();
    } catch (error) {
      handleError(error, {
        userMessage: "L'opération a échoué",
        showAlert: true,
        logError: true,
      });
    }
  };

  return <Button onPress={handleAction} title="Action" />;
};
```

#### Utilisation avec wrapper

```typescript
const { withErrorHandling } = useErrorHandler();

const handleAction = withErrorHandling(
  async () => {
    const result = await someAsyncOperation();
    return result;
  },
  {
    userMessage: "L'opération a échoué",
    showAlert: true,
  },
);
```

#### Combinaison avec loading state

```typescript
const { withLoadingAndErrorHandling } = useErrorHandler();
const [loading, setLoading] = useState(false);

const handleAction = async () => {
  const result = await withLoadingAndErrorHandling(
    async () => {
      return await someAsyncOperation();
    },
    setLoading,
    {
      userMessage: "L'opération a échoué",
      showAlert: true,
    },
  );

  if (result) {
    // Traiter le résultat
  }
};
```

#### Avec callback personnalisé

```typescript
const { handleError } = useErrorHandler();

handleError(error, {
  userMessage: 'Une erreur est survenue',
  showAlert: true,
  onError: (error) => {
    // Log personnalisé ou action supplémentaire
    analytics.track('error_occurred', { error: error.message });
  },
});
```

---

## useLoadingState

Hook pour gérer l'état de chargement de manière simple et réutilisable.

### Signature

```typescript
function useLoadingState(initialState?: boolean): {
  isLoading: boolean;
  startLoading: () => void;
  stopLoading: () => void;
  withLoading: <T>(fn: () => Promise<T>) => Promise<T>;
};
```

### Paramètres

- `initialState` (boolean, optionnel): État initial de chargement (défaut: `false`)

### Retour

- `isLoading`: État actuel de chargement
- `startLoading`: Fonction pour démarrer le chargement
- `stopLoading`: Fonction pour arrêter le chargement
- `withLoading`: Wrapper pour exécuter une fonction avec gestion automatique du loading

### Exemples d'utilisation

#### Utilisation basique

```typescript
import { useLoadingState } from '../hooks/useLoadingState';

const MyComponent = () => {
  const { isLoading, startLoading, stopLoading } = useLoadingState();

  const handleAction = async () => {
    startLoading();
    try {
      await someAsyncOperation();
    } finally {
      stopLoading();
    }
  };

  return (
    <>
      {isLoading && <ActivityIndicator />}
      <Button onPress={handleAction} title="Action" disabled={isLoading} />
    </>
  );
};
```

#### Utilisation avec wrapper

```typescript
const { isLoading, withLoading } = useLoadingState();

const handleAction = async () => {
  const result = await withLoading(async () => {
    return await someAsyncOperation();
  });
  // Le loading est automatiquement géré
};
```

#### État initial personnalisé

```typescript
const { isLoading, startLoading, stopLoading } = useLoadingState(true);

useEffect(() => {
  // Charger les données au montage
  const loadData = async () => {
    startLoading();
    try {
      await loadInitialData();
    } finally {
      stopLoading();
    }
  };
  loadData();
}, []);
```

---

## Bonnes pratiques

1. **Utilisez `useAsync`** pour les opérations asynchrones qui nécessitent un état de chargement et de gestion d'erreur
2. **Utilisez `useErrorHandler`** pour une gestion d'erreur cohérente dans toute l'application
3. **Utilisez `useLoadingState`** pour des cas simples où vous n'avez besoin que de l'état de chargement
4. **Combinez les hooks** pour des cas plus complexes (ex: `useAsync` + `useErrorHandler`)

### Exemple de combinaison

```typescript
const { data, loading, error, execute } = useAsync(async () => competitionsService.findAll());

const { handleError } = useErrorHandler();

useEffect(() => {
  execute().catch((err) => {
    handleError(err, {
      userMessage: 'Impossible de charger les compétitions',
      showAlert: true,
    });
  });
}, []);
```
