---
name: repo-discovery-planning
description: Discover an unfamiliar Rust/Tauri/TypeScript repository and produce a bounded implementation plan before editing. Use for migrations, cross-cutting features, or unclear architecture.
---

# Repository Discovery and Planning

## Inspect first
- Read repository instructions, manifests, workspace layout, lockfiles, and build scripts.
- Identify exact Rust, Tauri, Node, TypeScript, Vite, and package-manager versions.
- Find the existing test, lint, format, build, and packaging commands.
- Trace one representative flow from UI to Rust and back.
- Search for established patterns before inventing new ones.

## Produce
State:
1. Current architecture and relevant files.
2. Desired behavior and non-goals.
3. Boundaries that will change.
4. Small implementation slices in dependency order.
5. Verification for each slice.
6. Risks, migrations, and rollback points.

## Constraints
- Prefer project evidence over memory.
- Do not upgrade dependencies unless required.
- Use current official documentation when an API or version is uncertain.
- Avoid broad rewrites when a narrow adapter or extraction works.
- Mark assumptions explicitly and resolve them through repository inspection when possible.

## Routing
Pair with the primary implementation skill after discovery. Add `change-verification` for any plan that will be executed.
