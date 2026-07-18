---
name: mcp-rust-tools
description: Build agent-friendly MCP servers and tools in Rust over the same application services used by the CLI and Tauri app. Use for tool schemas, resources, stdio transport, safety, and MCP testing.
---

# MCP Tools in Rust

## Architecture
MCP handlers are adapters. They validate protocol input, call the application service, and map results. Do not duplicate domain logic in tool handlers.

## Tool design
- Give each tool one clear operation.
- Use precise names and descriptions.
- Define strict schemas with useful field descriptions and bounds.
- Return stable structured content.
- Distinguish read-only, destructive, and externally visible actions.
- Require explicit inputs for destructive scope.
- Prefer preview/dry-run before mutation.
- Keep results bounded; paginate or summarize large output.

## Runtime
- For stdio transport, reserve stdout for protocol messages and send logs to stderr.
- Apply timeouts, cancellation, size limits, and concurrency limits.
- Do not expose secrets in tool results or errors.
- Version behavior that clients may depend on.
- Reuse the CLI/service authentication and authorization model where appropriate.

## Testing
Test schema validation, success, expected failures, cancellation, and side-effect boundaries. Exercise the server with the official MCP Inspector or repository test client.

## Routing
Pair with `rust-core`, `rust-errors-observability`, or `cli-gui-service-bridge`, selecting only what the current task needs.
