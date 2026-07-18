# Routing Map

Load `/rust-tauri` for mixed tasks. The installed router keeps specialist skills nested and loads the
smallest matching set. For direct tasks, activate the smallest matching skill.

| Task signal | Primary skill | Optional partner |
|---|---|---|
| Unfamiliar repo, migration, broad feature | `repo-discovery-planning` | implementation domain |
| Domain model, service, reusable crate | `rust-core` | `rust-errors-observability` |
| Command, flag, JSON output, exit code | `rust-cli` | `cli-gui-service-bridge` |
| Tokio, task, lock, channel, cancellation | `rust-async` | `rust-errors-observability` |
| Error taxonomy, logs, tracing | `rust-errors-observability` | boundary skill |
| Tests, Clippy, formatting | `rust-quality` | Rust implementation skill |
| Tauri workspace and dependency direction | `tauri2-architecture` | `cli-gui-service-bridge` |
| Invoke, command, event, channel, capability | `tauri2-ipc-security` | `typescript-strict` |
| GUI uses CLI/daemon/service | `cli-gui-service-bridge` | `rust-async` |
| Windows NSIS, bundled CLI, signing | `tauri2-windows-nsis` | `change-verification` |
| TypeScript state, DTO, component logic | `typescript-strict` | `tauri2-ipc-security` |
| Vite config, build, aliases, plugin | `vite-build` | `typescript-strict` |
| Tokens, selectors, layout CSS | `css-design-system` | `accessible-responsive-ui` |
| Keyboard, semantics, narrow window | `accessible-responsive-ui` | `css-design-system` |
| Visual redesign or new screen | `frontend-visual-design` | CSS or accessibility |
| MCP tool/server/resource | `mcp-rust-tools` | `rust-core` |
| Completion or release proof | `change-verification` | changed domain |

## Context budget

- Simple edit: 1 specialist
- Cross-boundary edit: 2 specialists
- Migration/release: 3 specialists maximum
- Load a new skill only after dropping one that no longer affects the active step
