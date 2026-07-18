---
name: tauri2-ipc-security
description: Build secure, typed Tauri 2 commands, events, channels, capabilities, and plugin permissions. Use whenever the webview calls Rust or Rust sends data to the frontend.
---

# Tauri 2 IPC and Security

## Command design
- Expose narrow task-oriented commands, not generic filesystem, shell, SQL, or arbitrary invocation endpoints.
- Use explicit request and response DTOs.
- Validate all paths, identifiers, ranges, modes, and user-controlled strings in Rust.
- Return stable success and error envelopes.
- Batch chatty operations; IPC is a boundary, not a local function call.

## Communication choice
- Commands: request/response work.
- Events: low-frequency notifications where delivery is not a transaction.
- Channels or streams: ordered progress or larger streamed results.
- Do not evaluate generated JavaScript to move normal application data.

## Security
- Grant the minimum Tauri capabilities per window and platform.
- Enable only required plugin permissions.
- Keep shell and filesystem scopes narrow.
- Never accept an arbitrary executable plus arbitrary arguments from the webview.
- Treat frontend code and IPC input as untrusted.
- Review new plugins as new trust boundaries.

## Type synchronization
Generate or centrally define TypeScript contracts where practical. At minimum, add serialization tests and frontend runtime validation for external or versioned data.

## Routing
Pair with `typescript-strict`. Add `tauri2-architecture` when state or dependency direction changes.
