# ADR-0013: HelloAsso for Club Payment Processing

**Date**: 2026-02-01
**Status**: accepted
**Deciders**: Gabin Simond

## Context

FFD clubs need to collect payments for competition seat bookings. Clubs are French non-profit associations (loi 1901) that typically already have HelloAsso accounts for memberships and events. The system is multi-tenant: each club manages its own credentials and payment flows.

## Decision

Integrate HelloAsso API with OAuth2 `client_credentials` per club. Token caching avoids rate limits. Webhooks handle order confirmation and update booking status.

## Alternatives Considered

### Alternative 1: Stripe
- **Pros**: Global reach, excellent developer experience, robust API
- **Cons**: Clubs would need to create new Stripe accounts, less familiar to French associations
- **Why not**: Adds friction — clubs already have HelloAsso, and Stripe charges transaction fees associations want to avoid

### Alternative 2: PayPal
- **Pros**: Widely known, supports multiple payment methods
- **Cons**: Less integrated with French association ecosystem, higher fees
- **Why not**: No advantage over HelloAsso for this specific user base

### Alternative 3: Bank transfer (virement)
- **Pros**: No third-party dependency, zero fees
- **Cons**: No automation, manual reconciliation required
- **Why not**: Does not scale for a platform handling multiple clubs and competitions

## Consequences

### Positive
- Zero friction for clubs — they reuse existing HelloAsso accounts
- Supports CB, PayPal, and virement through a single integration
- Built-in tax receipt generation for donors/participants

### Negative
- Tied to French market — HelloAsso is not viable for international expansion
- OAuth2 token management adds complexity per tenant
- Webhook reliability depends on HelloAsso uptime
