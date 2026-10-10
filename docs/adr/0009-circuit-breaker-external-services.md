# ADR-0009: Circuit Breaker for External Services

**Date**: 2026-03-26
**Status**: accepted
**Deciders**: Gabin Simond

> **Note (2026-10)** : la liste des services ci-dessous est historique. GenAI (Gemini, `@google/genai`) a été retiré du backend (#216) et Google Vision/TTS ont migré vers Azure AI (#658). La décision reste valable.

## Context

The backend depends on 6+ external services (Google Vision, TTS, GenAI, WDSF API, FFD API, HelloAsso). When any of these services goes down, requests can hang for 30 seconds or more, causing cascading failures across the application. Without a circuit breaker, a single slow dependency can exhaust connection pools and degrade the entire system.

## Decision

Use the Opossum circuit breaker library with per-service configuration. Settings: 50% error threshold to trip the circuit, 10-30 second timeout per service, and 30-60 second reset window. Each circuit transitions through three states: CLOSED (normal) -> OPEN (fast-fail) -> HALF-OPEN (probe).

## Alternatives Considered

### Alternative 1: Retry-only strategy

- **Pros**: Simple implementation, handles transient failures
- **Cons**: Retries against a dead service waste resources and increase latency
- **Why not**: Makes cascading failures worse by multiplying requests to an already failing service

### Alternative 2: Timeout-only strategy

- **Pros**: Prevents indefinite hangs, easy to configure
- **Cons**: No fast-fail mechanism; every request still waits for the full timeout duration
- **Why not**: Does not prevent resource exhaustion when a service is consistently down

### Alternative 3: Polly/.NET-style resilience library

- **Pros**: Rich policy composition, well-documented patterns
- **Cons**: .NET ecosystem, no native Node.js equivalent with the same API
- **Why not**: Not a natural fit for a Node.js/NestJS backend

## Consequences

### Positive

- Failed external services are detected quickly and requests fast-fail instead of hanging
- Per-service configuration allows tuning timeouts to each dependency's SLA
- Opossum event emitters enable logging circuit state changes for observability
- HALF-OPEN state automatically probes recovery without manual intervention

### Negative

- Adds a dependency on the Opossum library
- Per-service circuit configuration must be maintained as new external services are added
- Callers must handle circuit-open errors gracefully (fallback responses or user-facing messages)
