---
description: Route Rust/Tauri/TypeScript app work through the compact skill pack.
argument-hint: "[On|Off|Status]"
---

# /rust-tauri

Use `app-engineering-router` first, then load only the specialist skills it selects.

## Arguments
- No argument: route the current request through `app-engineering-router`.
- `On`: run `rtas rust-tauri on` from the workspace root. This writes a workspace-local `AGENTS.md` block so future AI-agent development uses this skill pack automatically.
- `Off`: run `rtas rust-tauri off` from the workspace root. This removes only the managed workspace-local block.
- `Status`: run `rtas rust-tauri status` from the workspace root.

Do not paste all specialist skills into context. Keep routing split across `SKILL.md` files.
