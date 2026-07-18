---
name: rust-core
description: Implement maintainable Rust domain logic and crate boundaries with explicit invariants and minimal coupling. Use for core services, models, repositories, and reusable application logic.
---

# Rust Core

## Design
- Keep domain and application logic independent of Tauri, CLI parsing, UI DTOs, and transport code.
- Model invalid states out with enums, newtypes, constructors, and private fields.
- Pass dependencies through traits only where substitution is useful.
- Prefer small modules organized by capability, not generic utility buckets.
- Keep public APIs smaller than internal APIs.

## Implementation
- Borrow when ownership is unnecessary; own data at asynchronous or long-lived boundaries.
- Return `Result` for expected failure and reserve panics for broken invariants.
- Avoid `unwrap`, `expect`, and lossy conversion outside tests or proven invariants.
- Prefer explicit transformations over clever iterator chains when clarity suffers.
- Make side effects visible in function signatures and service boundaries.

## Boundary rule
Adapters translate:
- CLI arguments → application requests
- Tauri DTOs → application requests
- Application results → CLI/UI/MCP responses

The core must not know which adapter called it.

## Completion
Add tests around observable behavior and invariants, not private implementation details.

## Routing
Pair with `rust-errors-observability` for error design, `rust-async` for concurrency, or `rust-quality` for final gates.
