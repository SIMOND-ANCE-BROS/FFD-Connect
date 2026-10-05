# Gestion d'erreurs - Guide de référence

Ce document décrit le système de gestion d'erreurs centralisé de l'application FFD Connect.

## Format des réponses d'erreur API (backend)

Toutes les erreurs HTTP renvoyées par l'API ont un format standard (géré par `HttpExceptionFilter`) :

```json
{
  "statusCode": 400,
  "timestamp": "2026-02-22T12:00:00.000Z",
  "path": "/auth/login",
  "method": "POST",
  "message": "Validation failed"
}
```

- **statusCode** : code HTTP (4xx, 5xx)
- **timestamp** : date/heure ISO
- **path** : chemin de la requête
- **method** : méthode HTTP
- **message** : message d'erreur (chaîne ou tableau de messages de validation)

La documentation Swagger (`/api`) décrit les codes possibles par endpoint ; le décorateur `@ApiCommonErrorResponses()` documente 400, 401, 403, 404, 409, 429, 500.

Pour typer les réponses d'erreur côté client, utiliser le type partagé `ApiErrorResponse` de `@ffd-connect/shared` (aligné sur ce format).

## Architecture

### api (axios) vs httpInterceptor (fetch)

Le client dispose de deux façons d'appeler l'API. Ce n'est **pas unifié** pour des raisons historiques et de cas d'usage différents ; les deux restent pertinents.

#### Pourquoi deux mécanismes ?

- **`api` (axios)** a été mis en place en premier : intercepteurs pour l'auth (token depuis AsyncStorage), retry global côté réponse, et gestion 401 (nettoyage du token + logout). Toute la couche "app connectée" (AuthService, ClubService, TrackService, CompetitionContext, etc.) s'appuie dessus.
- **`httpRequest` (fetch)** a été ajouté ensuite pour les cas où l'on veut un **contrôle explicite** par appel : retry configurable (nombre, backoff), message d'erreur utilisateur (`errorMessage`), typage `HttpError`, et pas de dépendance à l'auth (utile pour des appels publics ou un service dédié comme BackendService qui construit l'URL complète).

Unifier (tout migrer vers l'un ou l'autre, ou un seul wrapper) impliquerait soit un gros refactor, soit une couche qui appelle l'autre, avec peu de gain par rapport au coût. On garde donc les deux, avec une règle claire.

#### Intérêt de chacun

| Critère      | **`api`** (axios)                                                     | **`httpRequest`** (fetch)                                                                              |
| ------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Auth**     | Token injecté automatiquement depuis AsyncStorage sur chaque requête. | Pas d'injection : l'appelant doit passer les headers si besoin (ex. BackendService avec URL complète). |
| **Base URL** | `baseURL` configurée une fois (config).                               | URL complète à fournir (souvent `BACKEND_URL + path`).                                                 |
| **Retry**    | Retry global dans l'interceptor (2 tentatives, délai fixe).           | Retry par appel, configurable (maxRetries, backoff, `shouldRetry`).                                    |
| **401**      | Gestion centralisée : clear token + log (sauf login/forgot-password). | Pas de gestion automatique ; à gérer dans le code appelant.                                            |
| **Erreur**   | Erreurs Axios (réponse, config).                                      | `HttpError` typé + `errorMessage` pour l'affichage utilisateur.                                        |

#### Règle d'usage

- **Nouveaux appels** où tu veux retry + message utilisateur explicite → privilégier `httpRequest` (ou `httpGet`/`httpPost`).
- **Code existant** qui utilise `api` → **ne pas migrer sans raison** ; l'existant peut rester sur `api`.
- Ne pas mélanger les deux pour le même type d'appel sans motif (ex. une route en `api`, une autre en `httpRequest` pour la même feature, sans besoin précis).

### Messages d'erreur centralisés

Tous les messages d'erreur sont définis dans `/apps/client/src/constants/errorMessages.ts` :

```typescript
import { ERROR_MESSAGES } from '../constants/errorMessages';

// Utilisation
Alert.alert('Erreur', ERROR_MESSAGES.NETWORK_ERROR);
```

### Retry automatique

Le système de retry automatique est intégré dans `httpInterceptor.ts` et peut être activé pour les requêtes HTTP :

```typescript
import { httpRequest } from '../utils/httpInterceptor';

// Retry automatique avec options par défaut (3 tentatives)
const data = await httpRequest('/api/competitions', {
  retry: true,
});

// Retry avec options personnalisées
const data = await httpRequest('/api/competitions', {
  retry: {
    maxRetries: 5,
    initialDelay: 500,
    backoffFactor: 2,
    maxDelay: 10000,
  },
});
```

## Utilisation

### Avec httpInterceptor

```typescript
import { httpRequest, HttpError } from '../utils/httpInterceptor';
import { ERROR_MESSAGES } from '../constants/errorMessages';

try {
  const data = await httpRequest('/api/competitions', {
    retry: true, // Active le retry automatique
    errorMessage: ERROR_MESSAGES.LOADING_FAILED,
  });
} catch (error) {
  if (error instanceof HttpError) {
    // Gérer selon le code de statut
    switch (error.statusCode) {
      case 401:
        // Rediriger vers login
        break;
      case 404:
        // Afficher message "non trouvé"
        break;
      default:
      // Afficher message générique
    }
  }
}
```

### Avec useErrorHandler

```typescript
import { useErrorHandler } from '../hooks/useErrorHandler';
import { ERROR_MESSAGES } from '../constants/errorMessages';

const MyComponent = () => {
  const { handleError, withErrorHandling } = useErrorHandler();

  const loadData = withErrorHandling(
    async () => {
      const data = await httpRequest('/api/data', { retry: true });
      return data;
    },
    {
      userMessage: ERROR_MESSAGES.LOADING_FAILED,
      showAlert: true,
    }
  );

  return <Button onPress={loadData} title="Charger" />;
};
```

### Avec retry manuel

```typescript
import { retry } from '../utils/retry';
import { httpRequest } from '../utils/httpInterceptor';

const loadData = async () => {
  return retry(() => httpRequest('/api/data'), {
    maxRetries: 3,
    initialDelay: 1000,
    shouldRetry: (error) => {
      // Logique personnalisée pour déterminer si on doit retry
      return error instanceof HttpError && error.statusCode >= 500;
    },
  });
};
```

## Codes d'erreur HTTP

### Codes retentés automatiquement

- **0** - Erreur réseau (pas de connexion)
- **408** - Timeout
- **429** - Rate limit
- **500-599** - Erreurs serveur

### Codes non retentés

- **400-499** (sauf 408, 429) - Erreurs client (ne pas retry)

## Configuration du retry

### Options par défaut

```typescript
{
  maxRetries: 3,           // 3 tentatives au total
  initialDelay: 1000,      // 1 seconde initiale
  backoffFactor: 2,        // Double à chaque tentative
  maxDelay: 10000,         // Maximum 10 secondes
}
```

### Exemple de délais

- Tentative 1 : Immédiate
- Tentative 2 : Après 1 seconde
- Tentative 3 : Après 2 secondes
- Tentative 4 : Après 4 secondes

## Bonnes pratiques

1. **Utilisez les messages centralisés** - Toujours utiliser `ERROR_MESSAGES` au lieu de chaînes hardcodées
2. **Activez le retry pour les requêtes critiques** - Utilisez `retry: true` pour les opérations importantes
3. **Gérez les erreurs spécifiques** - Utilisez `HttpError.statusCode` pour gérer différemment selon le type d'erreur
4. **Log les erreurs** - Le système log automatiquement, mais vous pouvez ajouter des logs personnalisés
5. **Informez l'utilisateur** - Utilisez `showAlert: true` dans `useErrorHandler` pour informer l'utilisateur

## Exemples complets

### Chargement avec retry et gestion d'erreur

```typescript
import { useState, useEffect } from 'react';
import { httpRequest, HttpError } from '../utils/httpInterceptor';
import { useErrorHandler } from '../hooks/useErrorHandler';
import { ERROR_MESSAGES } from '../constants/errorMessages';

const MyComponent = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { handleError } = useErrorHandler();

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const result = await httpRequest('/api/competitions', {
          retry: {
            maxRetries: 3,
            initialDelay: 1000,
          },
          errorMessage: ERROR_MESSAGES.COMPETITION_LOAD_FAILED,
        });
        setData(result);
      } catch (error) {
        handleError(error, {
          userMessage: ERROR_MESSAGES.COMPETITION_LOAD_FAILED,
          showAlert: true,
        });
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  if (loading) return <ActivityIndicator />;
  if (!data) return <Text>Aucune donnée</Text>;
  return <DataView data={data} />;
};
```

### Retry conditionnel

```typescript
const loadData = async (isCritical: boolean) => {
  return httpRequest('/api/data', {
    // Retry seulement pour les opérations critiques
    retry: isCritical
      ? {
          maxRetries: 5,
          initialDelay: 500,
        }
      : false,
  });
};
```
