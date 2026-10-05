# ADR-0002: NestJS as Backend Framework

**Date**: 2026-01-14
**Status**: accepted
**Deciders**: Gabin Simond

## Context

The project needs a TypeScript backend framework to serve REST APIs for mobile and web clients. Requirements include JWT authentication, request validation, auto-generated Swagger documentation, WebSocket support for real-time features, and job queues for background processing. The framework must support a modular, domain-driven architecture as the codebase grows.

## Decision

Use NestJS 11 with a modular architecture organized into 14 domain modules. Leverage the NestJS ecosystem for cross-cutting concerns: `@nestjs/swagger` for OpenAPI, `@nestjs/bullmq` for queues, and `@nestjs/websockets` for real-time communication.

## Alternatives Considered

### Alternative 1: Express.js
- **Pros**: Lightweight, massive ecosystem, minimal learning curve
- **Cons**: No built-in dependency injection, no opinionated structure, manual setup for everything
- **Why not**: Too low-level; building auth guards, validation pipes, and module boundaries from scratch is error-prone and slow

### Alternative 2: Fastify
- **Pros**: High performance, schema-based validation, plugin system
- **Cons**: Smaller ecosystem for enterprise patterns, no native DI container
- **Why not**: Lighter ecosystem for auth, Swagger, and WebSockets; NestJS can use Fastify as its HTTP adapter if needed

### Alternative 3: Hono
- **Pros**: Ultra-lightweight, edge-ready, modern API design
- **Cons**: No native dependency injection, young ecosystem, limited middleware for enterprise needs
- **Why not**: Too new for production use with complex domain logic; lacks mature tooling for queues and WebSockets

## Consequences

### Positive
- Built-in dependency injection enables testable, loosely coupled modules
- Decorators, guards, interceptors, and pipes provide clean cross-cutting concern handling
- First-party packages for Swagger, queues, WebSockets, and scheduling reduce integration effort
- Opinionated structure scales well as the team and feature set grow

### Negative
- Steeper initial learning curve compared to plain Express
- Decorator-heavy code can feel verbose for simple endpoints
- Framework coupling makes migration to another framework costly
