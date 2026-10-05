# ADR-0011: New Relic for Backend APM, Sentry for Client Error Tracking

**Date**: 2026-03-16
**Status**: superseded — converged to Sentry-only (April 2026)
**Deciders**: Gabin Simond

## Context

We need crash reporting for the mobile app and APM for the backend. Different platforms have different monitoring needs — backend benefits from deep APM with transaction tracing and slow query detection, while mobile needs lightweight crash reporting with breadcrumbs and device context.

## Decision

Use New Relic for backend APM (first import in `main.ts` for auto-instrumentation, custom events for slow queries >500ms) and Sentry for client crash reporting and error tracking.

## Alternatives Considered

### Alternative 1: Sentry everywhere
- **Pros**: Single vendor, simpler billing, unified dashboards
- **Cons**: Sentry APM is less mature than New Relic for Node.js backends
- **Why not**: At time of decision, New Relic provided deeper backend insights

### Alternative 2: DataDog
- **Pros**: Excellent APM and log correlation
- **Cons**: Expensive at our scale
- **Why not**: Cost prohibitive for a non-profit-oriented project

### Alternative 3: Self-hosted (Grafana + Prometheus + Loki)
- **Pros**: No vendor lock-in, unlimited data
- **Cons**: Significant maintenance burden
- **Why not**: Team bandwidth better spent on product features

## Consequences

### Positive
- Platform-optimized monitoring for each target (backend vs mobile)
- New Relic auto-instrumentation catches performance regressions early

### Negative
- Two dashboards and two billing accounts to manage
- Harder incident correlation across backend and client
- Risk of tool sprawl — recommend converging to Sentry for both backend and client in future

## Current Integration Points (as of 2026-04)

### New Relic (backend + client logging)
| Location | Usage |
|---|---|
| `apps/backend/src/main.ts` | Auto-instrumentation (first import) |
| `apps/backend/src/common/filters/http-exception.filter.ts` | `newrelic.noticeError()` on 5xx |
| `apps/backend/src/common/metrics/metrics.service.ts` | `recordCustomEvent()` for slow requests/queries |
| `apps/client/src/utils/logger.ts` | `NewRelic.logDebug/Info/Warn/Error()` for structured mobile logging |

### Sentry (client crash reporting)
| Location | Usage |
|---|---|
| `apps/client/src/utils/logger.ts` | `Sentry.captureException()` on ERROR level logs |
| `apps/client/src/components/ErrorBoundary.tsx` | React error boundary capture |
| `apps/client/src/features/auth/hooks/useLoginLogic.ts` | Login error capture |
| `apps/client/src/features/player/context/LibraryContext.tsx` | Player error capture |

### Convergence Path (Sentry-only)
To migrate to Sentry-only, these steps are needed:
1. Add `@sentry/nestjs` to backend, configure in `main.ts` (replaces NR auto-instrumentation)
2. Replace `newrelic.noticeError()` in http-exception filter with `Sentry.captureException()`
3. Replace `newrelic.recordCustomEvent()` in metrics service with Sentry performance spans
4. Remove `newrelic-react-native-agent` from client `logger.ts` (Sentry already captures errors)
5. Remove `newrelic` and `@types/newrelic` from backend deps
6. Remove `newrelic-react-native-agent` from client deps
7. Update New Relic config files and environment variables
