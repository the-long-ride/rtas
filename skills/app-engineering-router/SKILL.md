---
name: app-engineering-router
description: Route Rust, Tauri 2, TypeScript, Vite, CSS, Windows packaging, and MCP work to the smallest useful specialist skill set. Use at the start of mixed or ambiguous application-engineering tasks.
---

# App Engineering Router

Slash command: `/rust-tauri` means load this router first. `/rust-tauri On` means future development in the current workspace should start here until `/rust-tauri Off`.

When installed by `rtas install`, this router is the only top-level skill. Its bundled specialists are available at the installed router's local `skills/<name>/SKILL.md` paths; load only the selected files.

## Goal
Load the least context that can complete the task correctly.

## Routing procedure
1. Inspect the request and changed files.
2. Select one primary skill.
3. Add a second skill only when the change crosses a real boundary.
4. Add a third only for verification, security, or packaging.
5. Never load more than three specialist skills at once.
6. Re-route after discovery if the initial assumption was wrong.

## Route table
- Unknown repository or migration scope → `repo-discovery-planning`
- Rust domain logic or crate structure → `rust-core`
- Commands, flags, stdout, exit codes → `rust-cli`
- Tokio, tasks, channels, locks, cancellation → `rust-async`
- Errors, logs, diagnostics, telemetry → `rust-errors-observability`
- Rust tests, linting, CI gates → `rust-quality`
- Tauri project boundaries and state → `tauri2-architecture`
- Commands, events, channels, permissions → `tauri2-ipc-security`
- GUI talking to a CLI/service process → `cli-gui-service-bridge`
- Windows installer, sidecar, PATH, signing → `tauri2-windows-nsis`
- TypeScript implementation or contracts → `typescript-strict`
- Vite configuration and builds → `vite-build`
- CSS architecture and tokens → `css-design-system`
- Keyboard, semantics, responsive behavior → `accessible-responsive-ui`
- Visual polish and deliberate aesthetics → `frontend-visual-design`
- MCP tools, resources, transports → `mcp-rust-tools`
- Final proof before completion → `change-verification`

## Rust rule corpus
For Rust impl, review, or refactor: read `references/rust-rule-index.md`; select category by task and priority; then load only needed `references/rust-rules/<rule-id>.md` files. Pair with relevant Rust specialist. Never load whole corpus.

## Common bundles
- New feature: discovery + primary domain + verification
- Tauri command: Tauri IPC + TypeScript
- Desktop/CLI integration: service bridge + Rust CLI + Tauri architecture
- UI redesign: visual design + CSS system + accessible UI
- Release: Windows NSIS + verification

## Stop conditions
Do not load a skill merely because its language appears in the repository. Load it only when its rules affect the requested change.
