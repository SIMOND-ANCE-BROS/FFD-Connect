# ADR-0007: Rate Limiting on Auth Endpoints

**Date**: 2026-04-02
**Status**: accepted
**Deciders**: Gabin Simond

## Context

Auth endpoints (login, forgot-password, reset-password) are prime targets for brute force and email bombing attacks. The existing global rate limit of 100 requests per minute is far too generous for these sensitive operations. Without endpoint-specific limits, an attacker can attempt thousands of password guesses or trigger mass password-reset emails before hitting any throttle.

## Decision

Apply endpoint-specific rate limits: login at 5/min, forgot-password at 3/min, and reset-password at 5/min. Implementation uses `@nestjs/throttler` with a custom `ThrottlerUserGuard` that tracks per-user when authenticated and per-IP otherwise.

### Amendment 2026-10-15 (#636): two limits per anti-abuse route

A per-IP limit sized for one person blocked dancers sharing one address (a gym Wi-Fi or mobile CGNAT on competition day): the 6th login in a minute from the venue got a 429. Login, register and forgot-password now carry two limits:

| Route                        | Per IP (`@ThrottleByIp`) | Per (identifier, IP) | Per identifier   |
| ---------------------------- | ------------------------ | -------------------- | ---------------- |
| `POST /auth/login`           | 20/min                   | 5/min on `username`  | 20/min           |
| `POST /auth/register`        | 20/min                   | 5/min on `email`     | 10/min           |
| `POST /auth/forgot-password` | 10/min                   | —                    | 3/min on `email` |

Identifiers are normalised like stored e-mails and hashed (SHA-256): no address sits in the throttler storage.

- The tight limit is keyed on the (identifier, address) pair: someone hammering an account from one address only blocks that address, never the owner signing in from their own network (no targeted lockout from a single address).
- The looser per-identifier limit holds brute force spread over many addresses. A distributed attacker can still exhaust it for a one-minute window: an accepted residual, far below the cost of an account lockout.
- Per IP, login went from 5 to 20/min: a venue can sign in, at the price of faster credential stuffing across many accounts from one address (4× the old rate). `forgot-password` keeps a per-identifier limit (protects the inbox); blocking a victim's reset for a minute is harmless.

`reset-password` keeps 5/min per IP: its token is unguessable.

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
