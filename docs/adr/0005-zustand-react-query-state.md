# ADR-0005: Zustand + React Query for State Management

**Date**: 2026-03-22
**Status**: accepted
**Deciders**: Gabin Simond

## Context

The client app accumulated 10+ React Context providers, creating "Provider Hell" in `App.tsx`. Context-based state caused unnecessary re-renders across the component tree. Server state (API data) was mixed with UI state (modals, forms, navigation) in the same contexts, making cache invalidation and offline support difficult to implement cleanly.

## Decision

Adopt a three-layer state strategy: Zustand for client/UI state (organized in `stores/`), React Query for server state (caching, background sync, deduplication), and Context API retained only for auth and theme where provider semantics are appropriate.

## Alternatives Considered

### Alternative 1: Redux Toolkit
- **Pros**: Battle-tested, large ecosystem, Redux DevTools, RTK Query for server state
- **Cons**: ~40KB bundle size, significant boilerplate (slices, reducers, selectors), steep learning curve
- **Why not**: Too heavy for a mobile app; Zustand achieves the same with ~2KB and no boilerplate

### Alternative 2: Recoil
- **Pros**: Atom-based model fits React mental model, concurrent mode support
- **Cons**: Facebook-only maintenance, uncertain long-term future, limited community growth
- **Why not**: Project sustainability concerns; no clear advantage over Zustand for our use cases

### Alternative 3: MobX
- **Pros**: Automatic reactivity via observables, minimal boilerplate, proven at scale
- **Cons**: Observable pattern adds implicit complexity, harder to debug state flow, proxy-based magic
- **Why not**: Implicit reactivity makes debugging harder; Zustand's explicit subscriptions are easier to trace

### Alternative 4: Keep Everything in Context
- **Pros**: No new dependencies, built into React, familiar API
- **Cons**: Re-renders entire subtree on any state change, no built-in caching or deduplication
- **Why not**: The root cause of the performance issues we are solving; does not scale beyond simple state

## Consequences

### Positive
- Zustand stores are ~2KB, zero boilerplate, and have excellent TypeScript support
- React Query handles cache invalidation, offline persistence via AsyncStorage, and request deduplication
- Clear separation: UI state in stores, server state in queries, auth/theme in context
- Provider count in `App.tsx` reduced from 10+ to 2 (auth and theme)

### Negative
- Two state libraries means two mental models for the team to learn
- Deciding where state belongs (store vs. query vs. context) requires judgment on each feature
- Migration from existing contexts is incremental and will coexist during transition
