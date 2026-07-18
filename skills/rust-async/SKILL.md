---
name: rust-async
description: Implement safe, bounded Rust asynchronous workflows with cancellation, backpressure, and clean shutdown. Use for Tokio tasks, channels, locks, streams, child processes, and long-running work.
---

# Rust Async and Concurrency

## Rules
- Do not hold mutex, read, write, or database guards across `.await`.
- Do not call blocking file, process, CPU-heavy, or synchronous network work on an async executor thread.
- Use bounded channels unless unbounded growth is intentionally proven safe.
- Give every spawned task an owner, shutdown path, and error-reporting path.
- Propagate cancellation through child operations.
- Apply timeouts at external boundaries.
- Avoid detached tasks for work whose result matters.

## State
Prefer:
1. Immutable shared state.
2. Message passing.
3. Fine-grained locks.
4. Global mutable state only as a last resort.

## Child processes
- Capture stdout and stderr independently.
- Drain both streams to avoid deadlock.
- Kill or gracefully stop children on cancellation and app shutdown.
- Avoid interpreting partial lines as complete protocol messages.

## Review checklist
Check for:
- Lock held across await.
- Unlimited task creation.
- Lost task errors.
- Missing timeout or cancellation.
- Race between startup and first request.
- Shutdown that hangs.

## Routing
Pair with `cli-gui-service-bridge` for a long-lived local service and `rust-errors-observability` for task diagnostics.
