# ADR-0007: Rate Limiting on Auth Endpoints

**Date**: 2026-04-02
**Status**: accepted
**Deciders**: Gabin Simond

## Context

Auth endpoints (login, forgot-password, reset-password) are prime targets for brute force and email bombing attacks. The existing global rate limit of 100 requests per minute is far too generous for these sensitive operations. Without endpoint-specific limits, an attacker can attempt thousands of password guesses or trigger mass password-reset emails before hitting any throttle.

## Decision

Apply endpoint-specific rate limits: login at 5/min, forgot-password at 3/min, and reset-password at 5/min. Implementation uses `@nestjs/throttler` with a custom `ThrottlerUserGuard` that tracks per-user when authenticated and per-IP otherwise.

## Alternatives Considered

### Alternative 1: CAPTCHA on auth endpoints
- **Pros**: Effective against automated attacks
- **Cons**: Poor UX on mobile, accessibility concerns, dependency on external CAPTCHA provider
- **Why not**: Mobile-first app cannot afford the friction; CAPTCHA solving services reduce effectiveness

### Alternative 2: Account lockout after N failures
- **Pros**: Simple to implement, directly stops brute force on a single account
- **Cons**: Creates a denial-of-service vector where attackers lock out legitimate users
- **Why not**: Lockout-based DoS is trivial to exploit and would harm real users

### Alternative 3: Global rate limit only
- **Pros**: Already in place, no additional work
- **Cons**: 100 req/min is far too permissive for auth; allows meaningful brute force attempts
- **Why not**: Does not match the threat model for sensitive authentication flows

## Consequences

### Positive
- Brute force and credential stuffing attacks are throttled before meaningful progress
- Email bombing via forgot-password is limited to 3 attempts per minute
- Per-user tracking avoids false positives for users behind shared NAT/corporate IPs

### Negative
- Legitimate users who mistype passwords repeatedly may hit the limit
- Per-user tracking requires extracting user identity before throttle evaluation
- Rate limit configuration must be maintained per endpoint as new auth flows are added
