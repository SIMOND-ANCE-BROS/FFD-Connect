# ADR-0010: Redis + BullMQ for Job Queue and Caching

**Date**: 2026-03-22
**Status**: accepted
**Deciders**: Gabin Simond

## Context

The backend needs asynchronous processing for several long-running tasks: track downloads via yt-dlp (~2 min), BPM analysis with ffmpeg, FFD competition synchronization, and notification delivery. Processing these synchronously would block HTTP responses and degrade user experience. We also need a caching layer for items like TTS cache (30-day TTL).

## Decision

Use Redis + BullMQ for distributed job queues with two queues: `track-processing` and `ffd-sync`. Redis also serves as a shared cache layer. Docker Compose provides Redis as part of the infra profile.

## Alternatives Considered

### Alternative 1: Database-backed queue (Postgres SKIP LOCKED)
- **Pros**: No additional infrastructure, single data store
- **Cons**: Slower polling, no built-in retry/delay/priority
- **Why not**: Lacks the job management features BullMQ provides out of the box

### Alternative 2: In-process queue (in-memory)
- **Pros**: Zero infrastructure, simplest setup
- **Cons**: No persistence across restarts, no horizontal scaling
- **Why not**: Jobs would be lost on deploy or crash

### Alternative 3: RabbitMQ
- **Pros**: Battle-tested message broker, rich routing
- **Cons**: Heavier operational footprint, more complex setup
- **Why not**: Overkill for our queue needs; BullMQ covers our use cases with less overhead

## Consequences

### Positive
- BullMQ provides built-in retry, delay, priority, and concurrency controls
- Redis gracefully degrades — the app continues without cache if Redis is down
- Single Redis instance serves both queue and cache needs

### Negative
- Adds Redis as infrastructure dependency
- Requires monitoring Redis memory usage and eviction policies
- BullMQ ties us to Redis specifically (no swapping to another broker)
