# ADR-0012: Four-Level Testing Strategy with Mutation Testing

**Date**: 2026-02-15
**Status**: accepted
**Deciders**: Gabin Simond

## Context

High test coverage (90% on backend) does not guarantee test quality — tests can execute code paths without asserting meaningful behavior. We need confidence that our tests actually catch real bugs, especially in critical modules like authentication and competition logic.

## Decision

Adopt a four-level testing strategy: unit tests (Jest), integration tests (supertest + real DB), E2E tests (Playwright for web, Maestro for mobile), and mutation testing (Stryker on critical modules). Coverage thresholds are set per module (auth 94%, global 65%). Stryker enforces a 75% mutation score on auth, competitions, and common utilities. CI runs mutation tests on PRs only.

## Alternatives Considered

### Alternative 1: Coverage-only metrics
- **Pros**: Simple to measure and enforce
- **Cons**: Gives false security — high coverage with weak assertions
- **Why not**: Does not validate that tests catch regressions

### Alternative 2: Manual QA
- **Pros**: Catches UX issues automated tests miss
- **Cons**: Does not scale, slow feedback loop
- **Why not**: Complementary but not a substitute for automated quality checks

### Alternative 3: Property-based testing
- **Pros**: Finds edge cases automatically
- **Cons**: Different goal — tests input space, not assertion quality
- **Why not**: Complementary technique, does not replace mutation testing

## Consequences

### Positive
- Mutation testing validates that tests actually detect bugs
- Per-module thresholds prevent critical code from having weak tests
- Stryker runs only on PRs, keeping CI fast for regular pushes

### Negative
- Mutation testing is slow on first run (~10-15 min on targeted modules); incremental mode (see ADR-0016) reduces subsequent runs to ~3-5 min
- Stryker configuration requires maintenance as modules evolve
- Developers must understand mutation score to act on failures
