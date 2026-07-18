---
name: rust-errors-observability
description: Design typed Rust errors and useful diagnostics across core, CLI, Tauri, and MCP boundaries. Use when adding failure paths, logging, tracing, or user-visible error handling.
---

# Rust Errors and Observability

## Error layers
- Domain/application crates: typed errors with stable variants.
- Infrastructure adapters: preserve source errors and add operation context.
- Executable boundaries: convert errors into CLI exit codes, Tauri DTOs, or MCP errors.
- UI: show actionable messages; keep technical detail available for diagnostics.

## Rules
- Never discard a source error without intent.
- Do not expose secrets, tokens, raw credentials, or sensitive paths.
- Avoid string matching to classify errors.
- Separate user mistakes, unavailable dependencies, conflicts, cancellation, and internal defects.
- Include stable machine-readable error codes at cross-language boundaries.

## Logging
- Prefer structured fields over interpolated prose.
- Add request or operation identifiers for multi-step work.
- Log lifecycle transitions and failures, not every trivial function call.
- Use stderr for logs in stdio protocols.
- Avoid duplicate logging at every layer; log where recovery or presentation is decided.

## Completion
Test important error mappings and confirm cancellation is not reported as an internal crash.

## Routing
Pair with any Rust boundary skill. Use with `typescript-strict` when defining frontend error unions.
