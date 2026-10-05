# ADR-0008: Swagger UI Hidden in Production

**Date**: 2026-04-02
**Status**: accepted
**Deciders**: Gabin Simond

## Context

Swagger UI served at `/api` exposes the full API documentation including all endpoints, request/response schemas, authentication flows, and parameter constraints. This significantly aids reconnaissance for attackers targeting the production API. Additionally, missing CORS configuration in production could leave the API open to cross-origin abuse.

## Decision

Swagger UI is only served in non-production environments (development, staging). In production, the `CORS_ORIGINS` environment variable is mandatory and the application exits fatally if it is missing.

## Alternatives Considered

### Alternative 1: Protect Swagger with an API key
- **Pros**: Swagger remains accessible for debugging production issues
- **Cons**: Adds another secret to manage, risk of key leakage
- **Why not**: Increases attack surface and operational complexity for minimal benefit

### Alternative 2: Keep Swagger public
- **Pros**: Zero configuration, useful for third-party integrators
- **Cons**: Full information disclosure of API surface, aids automated vulnerability scanning
- **Why not**: No external consumers need interactive docs; information disclosure risk outweighs convenience

### Alternative 3: Host Swagger on a separate docs domain
- **Pros**: Isolates docs from API, can apply separate access controls
- **Cons**: Additional infrastructure, DNS, and TLS certificate management
- **Why not**: Disproportionate infrastructure overhead for an internal-only tool

## Consequences

### Positive
- Production API surface is not publicly documented, raising the bar for attackers
- Fatal exit on missing CORS config prevents accidental misconfiguration in production
- Development and staging environments retain full Swagger access for productivity

### Negative
- Production debugging loses interactive API exploration (must use generated TypeScript client or curl)
- Developers must ensure environment detection logic is correct to avoid accidentally hiding Swagger in staging
