# ADR-0001: Monorepo with pnpm Workspaces

**Date**: 2026-01-14
**Status**: accepted
**Deciders**: Gabin Simond

## Context

FFD-Connect consists of 4 applications (backend NestJS, client React Native/Expo, landing Vite, docs Astro) plus shared packages. TypeScript types, ESLint configurations, and Jest presets need to be shared across all apps. Managing these as separate repositories would create duplication and version drift. A monorepo approach allows atomic changes across the stack.

## Decision

Use pnpm workspaces with a `packages/` directory for shared code (`@ffd-connect/shared`, `eslint-config`, `jest-config`). Each app lives under `apps/` and references shared packages via the `workspace:*` protocol.

## Alternatives Considered

### Alternative 1: Nx
- **Pros**: Powerful dependency graph, computation caching, code generators
- **Cons**: Heavy learning curve, complex configuration, opinionated project structure
- **Why not**: Overkill for 4 apps; adds significant complexity without proportional benefit

### Alternative 2: Turborepo
- **Pros**: Fast task runner with remote caching, simpler than Nx
- **Cons**: Primarily a task runner, still adds a layer of abstraction
- **Why not**: Task orchestration is not our bottleneck; pnpm scripts suffice for 4 apps

### Alternative 3: Separate Repositories
- **Pros**: Complete isolation, independent CI/CD, simple per-repo tooling
- **Cons**: No code sharing without publishing packages, cross-repo changes require coordination
- **Why not**: Sharing types between backend and client is a core requirement

### Alternative 4: npm/yarn Workspaces
- **Pros**: Familiar tooling, built into npm/yarn
- **Cons**: Slower installs, phantom dependency issues (npm), less strict isolation
- **Why not**: pnpm's hardlink strategy and strict node_modules structure are measurably faster and safer

## Consequences

### Positive
- Fast installs via content-addressable storage and hardlinks
- Strict dependency isolation prevents phantom dependency bugs
- Single lockfile and atomic commits across all apps
- `workspace:*` protocol makes inter-package references explicit

### Negative
- Team members must learn pnpm-specific commands and workspace conventions
- Some tooling (e.g., certain VS Code extensions) may not fully support pnpm symlink structure
