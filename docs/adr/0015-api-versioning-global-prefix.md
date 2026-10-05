# ADR-0015: API Versioning via Global Prefix

**Date**: 2026-03-25
**Status**: accepted
**Deciders**: Gabin Simond

## Context

The mobile app is distributed via app stores — old versions cannot be force-updated immediately. Backend API changes could break clients still running previous versions. We need a versioning strategy that allows old and new clients to coexist during rollout periods.

## Decision

Apply a global prefix `/api/v1` on all routes, except `/health` which is excluded for load balancer and monitoring compatibility.

## Alternatives Considered

### Alternative 1: No versioning
- **Pros**: Simplest approach, no prefix overhead
- **Cons**: Breaking changes immediately affect all clients
- **Why not**: Unacceptable risk given app store update lag

### Alternative 2: Header-based versioning (Accept-Version)
- **Pros**: Clean URLs, flexible
- **Cons**: Harder to route at the infrastructure level, harder to cache
- **Why not**: Adds complexity without meaningful benefit for our use case

### Alternative 3: Subdomain versioning (v1.api.example.com)
- **Pros**: Clean separation, independent deployments possible
- **Cons**: DNS and certificate management overhead
- **Why not**: Infrastructure complexity disproportionate to our scale

## Consequences

### Positive
- Simple, explicit, and easily routable at the reverse proxy level
- When v2 is needed, both versions can coexist in the same deployment
- Mobile clients pin to their API version and upgrade on their own schedule

### Negative
- All routes carry the `/api/v1` prefix, slightly longer URLs
- No built-in mechanism to deprecate or sunset old versions — requires manual tracking
- Health endpoint exception is a special case that must be documented
