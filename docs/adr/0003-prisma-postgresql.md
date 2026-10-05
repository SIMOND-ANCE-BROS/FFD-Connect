# ADR-0003: Prisma ORM with PostgreSQL

**Date**: 2026-01-14
**Status**: accepted
**Deciders**: Gabin Simond

## Context

The application manages relational data including users, competitions, events, registrations, licenses, and results. The schema has complex relations such as partnerships between users from different clubs and deep chains like competition -> events -> registrations -> results. We need an ORM that provides strong TypeScript integration and a reliable migration system. The database must handle ACID transactions and support JSON fields for flexible metadata.

## Decision

Use Prisma 7 with PostgreSQL 15. Organize the schema into modular files under `prisma/schema/` for maintainability. Prisma serves as the single source of truth for the database schema, generating a fully typed TypeScript client.

## Alternatives Considered

### Alternative 1: TypeORM
- **Pros**: Mature, supports multiple databases, Active Record and Data Mapper patterns
- **Cons**: Runtime decorators are fragile, TypeScript types can drift from actual schema
- **Why not**: Less type-safe than Prisma's generated client; decorator-based schema definition is harder to reason about

### Alternative 2: Drizzle ORM
- **Pros**: Lightweight, SQL-like query builder, excellent TypeScript inference
- **Cons**: Newer project, migration tooling less mature, smaller community
- **Why not**: Migration system not as battle-tested; Prisma's declarative schema is more approachable for the team

### Alternative 3: MikroORM
- **Pros**: Unit of Work pattern, identity map, good TypeScript support
- **Cons**: Smaller ecosystem, less community content, steeper learning curve
- **Why not**: Smaller community means fewer resources for troubleshooting; Prisma's DX is superior for rapid development

## Consequences

### Positive
- Generated TypeScript client guarantees type safety between code and database
- Declarative schema file is a readable single source of truth
- Migration system tracks schema changes with version control
- PostgreSQL provides ACID compliance, JSON support, composite indexes, and proven reliability

### Negative
- Prisma's query engine adds a layer of abstraction that can complicate advanced SQL patterns
- Complex aggregations or raw queries may bypass Prisma's type safety
- Schema changes require running `prisma generate` to update the client
