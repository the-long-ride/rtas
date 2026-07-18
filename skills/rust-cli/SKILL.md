---
name: rust-cli
description: Design and implement stable Rust command-line interfaces for humans, scripts, GUI adapters, and AI agents. Use for subcommands, flags, output contracts, exit codes, and automation.
---

# Rust CLI

## Contract
- Treat command names, flags, JSON fields, stdout, stderr, and exit codes as public APIs.
- Keep human output separate from machine output.
- Provide a stable `--json` or equivalent structured mode for automation.
- Write structured results to stdout and diagnostics to stderr.
- Return nonzero exit codes for failure; map failure classes consistently.
- Support `--help` without initializing expensive services.

## Structure
Use thin command handlers:

```text
parse → validate → application service → render result → exit code
```

Do not place domain logic in argument parsing or output rendering.

## Agent-friendly behavior
- Prefer explicit subcommands over overloaded positional arguments.
- Make operations deterministic and idempotent where practical.
- Include stable identifiers in responses.
- Bound output size or support pagination.
- Never require parsing decorative human text.
- Avoid interactive prompts unless explicitly requested; provide noninteractive flags.

## Security
Never build shell commands by concatenating untrusted strings. Pass argument arrays to child processes and validate paths and modes.

## Compatibility
Do not rename or remove existing flags without a migration path and tests.

## Routing
Pair with `cli-gui-service-bridge` when the GUI calls the CLI/service, or `mcp-rust-tools` when commands back MCP tools.
