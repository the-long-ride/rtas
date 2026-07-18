---
name: cli-gui-service-bridge
description: Design a local architecture where a Tauri GUI, CLI commands, AI agents, and MCP tools share one Rust application service. Use for subprocess, daemon, named-pipe, or stdio integration.
---

# CLI–GUI Service Bridge

## Choose the topology
Prefer a shared Rust library when one process is sufficient. Choose a service process when you need independent lifetime, one authoritative worker, isolation, or reuse by external agents.

## Recommended process model
```text
Tauri UI → thin Tauri commands → service client
CLI one-shot/serve mode ───────→ application service
MCP adapter ───────────────────→ application service
```

The CLI may expose:
- One-shot commands for people and scripts.
- `serve` mode for the desktop and agents.
- A version/health command for diagnostics.

## Protocol
- Never parse human CLI output.
- Use framed JSON, JSON Lines, or a typed local transport.
- Include protocol version, request ID, operation, payload, and typed error.
- Define maximum message size, timeout, cancellation, and progress semantics.
- Perform a startup handshake before enabling UI actions.
- Make retries safe or mark operations non-idempotent.
- Handle service crash, restart, stale client, and version mismatch.

## Windows
Prefer named pipes for a long-lived local service and stdio for a child owned by Tauri. Restrict access to the current user. Use a lock or rendezvous mechanism to prevent accidental duplicate owners.

## Routing
Pair with `rust-async`, `rust-cli`, and `tauri2-architecture`; select at most two of them per task.
