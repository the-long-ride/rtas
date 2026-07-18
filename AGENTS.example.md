# AGENTS.md example

## Architecture

- `crates/app-core`: domain and application services; no Tauri dependency.
- `crates/app-protocol`: versioned request, response, and error DTOs.
- `crates/app-cli`: human and machine CLI adapter.
- `crates/app-desktop`: Tauri 2 adapter.
- `ui`: strict TypeScript and Vite frontend.

## Commands

Replace these placeholders with repository commands:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
npm run typecheck
npm run lint
npm run test
npm run build
npm run tauri build
```

## Project rules

- Route mixed tasks through `/rust-tauri`.
- Keep core behavior independent of CLI, Tauri, and MCP.
- Use structured protocols between processes.
- Keep stdout machine-readable in JSON/MCP modes; logs go to stderr.
- Validate every IPC, CLI, and MCP boundary.
- Do not add dependencies or upgrade major versions without explaining why.
- Do not declare completion without `change-verification`.
