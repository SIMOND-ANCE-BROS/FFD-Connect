# Auth Service Decomposition — Design

**Date:** 2026-03-31
**Status:** Approved

## Contexte

`AuthService` (603 lignes) regroupe 3 responsabilités : authentification core, gestion des refresh tokens, et gestion des mots de passe. Le controller (`auth.controller.ts`) injecte uniquement `AuthService` et lui délègue tout.

Objectif : décomposer en 3 services spécialisés, mettre à jour module et controller.

## Architecture cible

```
AuthController
  ├── AuthService            (slimmé — validateUser, login)
  ├── AuthTokenService       (nouveau — refresh token lifecycle)
  └── AuthPasswordService    (nouveau — password flows)
```

## Tâche 1 : Créer AuthTokenService

**Fichier :** `apps/backend/src/auth/auth-token.service.ts`

Extraire depuis `AuthService` :

- `createRefreshToken(userId)` (privé → public) — génère token, nettoie les expirés, crée en DB
- `refreshAccessToken(refreshToken)` — valide, rotation (révoque ancien + crée nouveau), retourne LoginResponse
- `revokeRefreshToken(refreshToken)` — révoque un token, retourne boolean
- `revokeAllUserTokens(userId)` — révoque tous les tokens d'un user, retourne count
- `cleanupExpiredTokens(userId)` (privé) — supprime les tokens expirés

Les constantes `REFRESH_TOKEN_EXPIRY_DAYS` (30) et `ACCESS_TOKEN_EXPIRY_MINUTES` (60) migrent ici (elles sont utilisées par ce service).

**Dépendances :** `PrismaService`, `JwtService`

**Spec :** `auth-token.service.spec.ts` — copier les describes `refreshAccessToken`, `revokeRefreshToken`, `revokeAllUserTokens` depuis `auth.service.spec.ts`.

## Tâche 2 : Créer AuthPasswordService

**Fichier :** `apps/backend/src/auth/auth-password.service.ts`

Extraire depuis `AuthService` :

- `forgotPassword(email)` — invalide les anciens tokens, génère nouveau token, envoie email
- `resetPassword(token, newPassword)` — valide token, met à jour password hashé
- `changePassword(userId, currentPassword, newPassword)` — vérifie ancien password, met à jour

La constante `PASSWORD_RESET_TOKEN_EXPIRY_HOURS` (1) migre ici.

**Dépendances :** `PrismaService`, `EmailService`

**Spec :** `auth-password.service.spec.ts` — copier les describes `forgotPassword`, `resetPassword`, `changePassword` depuis `auth.service.spec.ts`.

## Tâche 3 : Slim down AuthService

`AuthService` garde uniquement :

- `validateUser(username, pass)` — lookup user, bcrypt compare, auto-rehash
- `login(user)` — crée JWT access token + appelle `authTokenService.createRefreshToken()`

**Dépendances :** `PrismaService`, `JwtService`, `AuthTokenService`

**Spec :** `auth.service.spec.ts` — garder uniquement `validateUser` (+ describe rehash) et `login`. Supprimer les autres describes (ils sont dans leurs propres fichiers).

## Tâche 4 : Mettre à jour AuthModule

```typescript
@Module({
  imports: [PrismaModule, JwtModule.register(...), PassportModule],
  providers: [
    AuthService,
    AuthTokenService,
    AuthPasswordService,
    EmailService,
    JwtStrategy,
    SessionCleanupService,
  ],
  exports: [AuthService, AuthTokenService, AuthPasswordService],
})
export class AuthModule {}
```

## Tâche 5 : Mettre à jour AuthController

Remplacer l'injection unique `AuthService` par les 3 services :

```typescript
constructor(
  private authService: AuthService,
  private authTokenService: AuthTokenService,
  private authPasswordService: AuthPasswordService,
) {}
```

Routing des appels :

| Appel controller     | Service cible                         |
| -------------------- | ------------------------------------- |
| `validateUser`       | `authService.validateUser`            |
| `login`              | `authService.login`                   |
| `refreshAccessToken` | `authTokenService.refreshAccessToken` |
| `revokeRefreshToken` | `authTokenService.revokeRefreshToken` |
| `forgotPassword`     | `authPasswordService.forgotPassword`  |
| `resetPassword`      | `authPasswordService.resetPassword`   |
| `changePassword`     | `authPasswordService.changePassword`  |

## Contraintes

- Zéro changement de comportement observable
- `AuthService` n'a aucun consommateur externe — aucune mise à jour externe nécessaire
- Tests : 77 suites, 925 tests — tous doivent passer après chaque tâche
- TypeScript strict — typecheck propre obligatoire en fin de tâche 5
