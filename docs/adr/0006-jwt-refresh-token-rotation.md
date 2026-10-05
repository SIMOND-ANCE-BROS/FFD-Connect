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
