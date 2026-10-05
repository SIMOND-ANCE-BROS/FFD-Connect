# Documentation API

Documentation de l'API REST FFD Connect.

## Table des matières

- [Codes d'erreur HTTP](./swagger-error-codes.md) - Référence complète des codes d'erreur
- [Swagger UI](../../apps/backend/README.md#swagger) - Documentation interactive disponible à `/api`

## Accès à la documentation Swagger

Une fois le serveur backend démarré, la documentation Swagger est accessible à l'adresse :

```
http://localhost:3000/api
```

## Authentification

La plupart des endpoints nécessitent une authentification JWT. Pour obtenir un token :

1. Utilisez l'endpoint `/auth/login` avec vos identifiants
2. Récupérez le `access_token` de la réponse
3. Utilisez le bouton "Authorize" dans Swagger UI pour ajouter le token
4. Le token sera automatiquement inclus dans les en-têtes `Authorization: Bearer <token>`

## Structure de l'API

L'API est organisée en modules :

- **auth** - Authentification et gestion des tokens
- **competitions** - Gestion des compétitions et événements
- **licenses** - Gestion des licences WDSF
- **tracks** - Gestion de la bibliothèque musicale
- **users** - Gestion des utilisateurs
- **reports** - Rapports et signalements
- **notifications** - Notifications push
- **wdsf** - Intégration avec l'API WDSF
- **tts** - Text-to-Speech

## Codes de statut HTTP

Voir [swagger-error-codes.md](./swagger-error-codes.md) pour la liste complète des codes d'erreur.

## Exemples de requêtes

### Authentification

```bash
# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "user@example.com",
    "password": "password123"
  }'

# Refresh token
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "your-refresh-token"
  }'
```

### Compétitions

```bash
# Liste des compétitions (nécessite authentification)
curl -X GET http://localhost:3000/competitions \
  -H "Authorization: Bearer your-access-token"

# Détails d'une compétition
curl -X GET http://localhost:3000/competitions/comp-123 \
  -H "Authorization: Bearer your-access-token"
```

## Bonnes pratiques

1. **Toujours gérer les erreurs** - Vérifiez les codes de statut HTTP
2. **Utiliser les tokens de manière sécurisée** - Ne les exposez pas dans le code client
3. **Respecter les rate limits** - L'API peut limiter le nombre de requêtes
4. **Valider les données** - Utilisez les DTOs fournis pour valider les entrées
5. **Consulter Swagger** - La documentation Swagger est toujours à jour
