# ADR-0014: Service Decomposition by Responsibility

**Date**: 2026-02-24
**Status**: accepted
**Deciders**: Gabin Simond

## Context

Initial services grew large — CompetitionsService reached 800+ lines and ClubsService 600+ lines. They combined queries, mutations, external API calls, and notification dispatch in single classes. This made them hard to test in isolation, difficult to navigate, and prone to merge conflicts.

## Decision

Split services by responsibility: QueryService (reads), core Service (writes), and integration-specific services. For example, `CompetitionsService` became `CompetitionQueryService`, `CompetitionRegistrationService`, `CompetitionManagementService`, `CompetitionResultsService`, and `CompetitionSyncService`. Each service stays under 200 lines.

## Alternatives Considered

### Alternative 1: Keep monolithic services
- **Pros**: Simpler imports, single file to find all logic
- **Cons**: Hard to test, large files, frequent merge conflicts
- **Why not**: Complexity was already causing developer friction

### Alternative 2: Full CQRS
- **Pros**: Clean read/write separation, event sourcing ready
- **Cons**: Too formal for this scale, adds command/query bus overhead
- **Why not**: Over-engineering for a team of this size

### Alternative 3: Repository pattern
- **Pros**: Abstracts data access
- **Cons**: Added abstraction layer without clear benefit given Prisma already provides a clean query API
- **Why not**: Prisma already serves as the data access layer

## Consequences

### Positive
- Single Responsibility Principle — each service has one clear purpose
- Each file stays under 200 lines, improving readability
- Services are testable in isolation with clear dependency graphs

### Negative
- More files to navigate (mitigated by consistent naming conventions)
- Import paths are longer
- Requires discipline to maintain the decomposition as features grow
