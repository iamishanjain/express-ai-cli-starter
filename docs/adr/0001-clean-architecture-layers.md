# 1. Layered architecture with inward dependencies

Status: accepted

## Context

The original CLI was one file that created the Gemini provider directly and a renderer full of hardcoded strings. Adding a provider, database, or command meant editing core code.

## Decision

Split into `domain`, `application`, `infrastructure`, `presentation` and `shared`, with dependencies pointing inward and one composition root. Enforce it with ESLint. No DI framework: constructor injection and one `buildContext` function are enough.

## Consequences

- Core code depends on interfaces, so providers, stores and template sources can be replaced or faked.
- The cost is more files. We accepted it, but avoid adding layers or abstractions without a second use.
