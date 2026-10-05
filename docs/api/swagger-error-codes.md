# Codes d'erreur Swagger - Référence

Ce document liste tous les codes d'erreur HTTP standardisés utilisés dans l'API FFD Connect et leur signification.

## Codes d'erreur HTTP standard

### 400 - Bad Request
**Description**: La requête est malformée ou contient des données invalides.

**Exemples de cas**:
- Champs requis manquants
- Format de données invalide (email, date, etc.)
- Validation échouée
- L'utilisateur est déjà inscrit à un événement
- Données QR code invalides

**Format de réponse**:
```json
{
  "statusCode": 400,
  "message": "Validation failed" | ["field1 is required", "field2 must be an email"],
  "error": "Bad Request",
  "timestamp": "2026-02-12T10:00:00.000Z",
  "path": "/api/endpoint"
}
```

### 401 - Unauthorized
**Description**: L'utilisateur n'est pas authentifié ou le token est invalide/expiré.

**Exemples de cas**:
- Token JWT manquant
- Token JWT expiré
- Token JWT invalide
- Identifiants de connexion incorrects
- Refresh token invalide ou révoqué

**Format de réponse**:
```json
{
  "statusCode": 401,
  "message": "Unauthorized" | "Invalid credentials" | "Invalid or expired refresh token",
  "error": "Unauthorized",
  "timestamp": "2026-02-12T10:00:00.000Z",
  "path": "/api/endpoint"
}
```

### 403 - Forbidden
**Description**: L'utilisateur est authentifié mais n'a pas les permissions nécessaires.

**Exemples de cas**:
- Tentative d'accès à une ressource protégée
- Rôle insuffisant pour l'opération
- Accès refusé à une compétition privée

**Format de réponse**:
```json
{
  "statusCode": 403,
  "message": "Forbidden resource" | "Insufficient permissions",
  "error": "Forbidden",
  "timestamp": "2026-02-12T10:00:00.000Z",
  "path": "/api/endpoint"
}
```

### 404 - Not Found
**Description**: La ressource demandée n'existe pas.

**Exemples de cas**:
- Compétition non trouvée
- Événement non trouvé
- Utilisateur non trouvé
- Fichier audio non trouvé
- Inscription non trouvée
- Athlète WDSF non trouvé

**Format de réponse**:
```json
{
  "statusCode": 404,
  "message": "Resource not found" | "Event not found" | "File not found",
  "error": "Not Found",
  "timestamp": "2026-02-12T10:00:00.000Z",
  "path": "/api/endpoint"
}
```

### 409 - Conflict
**Description**: La ressource existe déjà ou entre en conflit avec l'état actuel.

**Exemples de cas**:
- Tentative de création d'une ressource qui existe déjà
- Conflit de données

**Format de réponse**:
```json
{
  "statusCode": 409,
  "message": "Resource already exists",
  "error": "Conflict",
  "timestamp": "2026-02-12T10:00:00.000Z",
  "path": "/api/endpoint"
}
```

### 429 - Too Many Requests
**Description**: Trop de requêtes ont été effectuées dans un laps de temps donné (rate limiting).

**Exemples de cas**:
- Trop de tentatives de connexion
- Trop de requêtes à un endpoint spécifique
- Rate limit dépassé

**Format de réponse**:
```json
{
  "statusCode": 429,
  "message": "Too many requests",
  "error": "Too Many Requests",
  "timestamp": "2026-02-12T10:00:00.000Z",
  "path": "/api/endpoint"
}
```

### 500 - Internal Server Error
**Description**: Erreur serveur interne non prévue.

**Exemples de cas**:
- Erreur de base de données
- Erreur lors du traitement d'un fichier audio
- Erreur inattendue dans le code serveur

**Format de réponse**:
```json
{
  "statusCode": 500,
  "message": "Internal server error" | "Failed to process audio file",
  "error": "Internal Server Error",
  "timestamp": "2026-02-12T10:00:00.000Z",
  "path": "/api/endpoint"
}
```

## Codes de succès

### 200 - OK
**Description**: Requête réussie.

### 201 - Created
**Description**: Ressource créée avec succès.

**Exemples**:
- Inscription à un événement créée
- Nouvelle musique ajoutée

### 204 - No Content
**Description**: Requête réussie mais aucune donnée à retourner.

## Utilisation dans Swagger

Pour documenter ces codes d'erreur dans vos contrôleurs, utilisez le décorateur `@ApiCommonErrorResponses()` ou documentez-les individuellement avec `@ApiResponse()`.

### Exemple avec ApiCommonErrorResponses

```typescript
import { ApiCommonErrorResponses } from '../common/decorators/api-error-responses.decorator';

@Post('example')
@ApiCommonErrorResponses()
async example() {
  // ...
}
```

### Exemple avec ApiResponse individuel

```typescript
@ApiResponse({
  status: 404,
  description: 'Ressource non trouvée',
  schema: {
    type: 'object',
    properties: {
      statusCode: { type: 'number', example: 404 },
      message: { type: 'string', example: 'Resource not found' },
      error: { type: 'string', example: 'Not Found' },
    },
  },
})
```

## Bonnes pratiques

1. **Toujours documenter les codes d'erreur possibles** pour chaque endpoint
2. **Utiliser des messages d'erreur clairs et descriptifs**
3. **Inclure des exemples** dans la documentation Swagger
4. **Standardiser les formats de réponse** d'erreur
5. **Documenter les cas spécifiques** (ex: "User already registered" pour 400)
