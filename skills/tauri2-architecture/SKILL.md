---
name: tauri2-architecture
description: Structure a Tauri 2 desktop application around a reusable Rust core, thin adapters, and explicit process ownership. Use for project layout, state, startup, shutdown, and migrations to Tauri.
---

# Tauri 2 Architecture

## Preferred workspace
```text
crates/app-core       domain and application services
crates/app-protocol   shared request/response types
crates/app-cli        CLI adapter and executable
crates/app-desktop    Tauri adapter and executable
ui/                   TypeScript/Vite frontend
```

Adjust names to the repository, but preserve dependency direction:

```text
UI → Tauri adapter → application service → domain/infrastructure
CLI ────────────────────────────────┘
MCP ────────────────────────────────┘
```

## Rules
- Core crates must not depend on Tauri.
- Tauri commands remain thin and return serializable DTOs.
- Keep window, tray, menu, and plugin setup in the desktop adapter.
- Store only intentional long-lived handles in Tauri state.
- Define startup readiness and shutdown order.
- Keep frontend state separate from authoritative application state.
- Prefer linking the shared core directly when process isolation is unnecessary.
- Use a service process only when CLI/agent reuse, isolation, or independent lifetime justifies it.

## Migration
Extract behavior behind tests before replacing the existing .NET adapter. Migrate vertical slices and keep a rollback point until parity is demonstrated.

## Routing
Pair with `tauri2-ipc-security` for commands and permissions, or `cli-gui-service-bridge` for process separation.
