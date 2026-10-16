# ADR-0006: JWT Refresh Token Rotation

**Date**: 2026-02-15
**Status**: accepted
**Deciders**: Gabin Simond

## Context

Mobile app needs long-lived sessions because users don't want to re-login daily, but short-lived tokens are essential for security. If a token is stolen, the blast radius must be minimized. A stateless approach for routine API calls is preferred to avoid per-request database lookups, while still allowing token revocation when needed.

## Decision

Use JWT access tokens (60 min TTL) paired with refresh tokens (30 days TTL) with rotation. On each refresh, the old refresh token is revoked and a new access/refresh pair is issued. Refresh tokens are stored as SHA-256 hashes in the database.

## Alternatives Considered

### Alternative 1: Session-based authentication

- **Pros**: Simple revocation, well-understood model
- **Cons**: Requires sticky sessions or shared session store, poor fit for mobile clients
- **Why not**: Sticky sessions add infrastructure complexity and degrade horizontal scaling

### Alternative 2: OAuth2 with external provider

- **Pros**: Battle-tested, offloads auth complexity
- **Cons**: External dependency, added latency, harder to customize flows
- **Why not**: Introduces a critical third-party dependency for a core feature

### Alternative 3: JWT-only with long expiry

- **Pros**: Simplest implementation, fully stateless
- **Cons**: Long-lived tokens cannot be revoked, stolen tokens grant extended access
- **Why not**: Unacceptable security risk for an app handling personal federation data

## Consequences

### Positive

- Stateless access tokens keep API response times low
- Refresh rotation limits the window of exploitation for stolen tokens
- SHA-256 hashing prevents token extraction from a compromised database
- Clean separation between short-lived access and long-lived session lifecycle

### Negative

- Requires database writes on every token refresh
- Token rotation adds complexity to the mobile client (must handle concurrent refresh races)
- Revocation checks on refresh tokens add a DB round-trip compared to pure stateless JWT

## Amendement 2026-10 — consommation atomique et course entre clients (#681)

**Constat** : la rotation lisait le jeton (`findUnique`), vérifiait `revoked`, puis le révoquait par un `update` sans condition. Deux `POST /auth/refresh` simultanés avec le même jeton passaient tous les deux la vérification et émettaient chacun une paire valide (un jeton de rafraîchissement orphelin, valable 30 jours).

**Décision** :

- Le jeton est consommé dans une transaction par un `updateMany` conditionnel (`id`, `revoked = false`, `expiresAt > maintenant`). Seul l'appel dont la mise à jour touche exactement une ligne émet la nouvelle paire ; PostgreSQL verrouille la ligne et le second écrivain réévalue la condition après le commit du premier, donc ne trouve plus rien.
- Le perdant de la course reçoit le même 401 qu'un jeton révoqué (`Invalid or expired refresh token`), **sans révoquer les autres sessions de l'utilisateur**. Une course est le fait d'un client légitime (deux onglets du back-office, deux instances de l'app) : le client reprend les jetons stockés par le gagnant (#676) et ne doit pas être déconnecté.
- **Pas de détection de réutilisation par famille pour l'instant** : sans notion de famille de jetons en base, « révoquer la famille » reviendrait à déconnecter tous les appareils de l'utilisateur, y compris pour des cas bénins (réponse de rotation perdue sur le réseau, onglet resté ouvert après une déconnexion). Une telle détection demanderait une colonne de famille (migration additive) et une fenêtre de grâce ; elle fera l'objet d'une décision séparée.
- Les jetons d'impersonation ne sont pas concernés : ce sont des jetons d'accès courts, sans jeton de rafraîchissement.
