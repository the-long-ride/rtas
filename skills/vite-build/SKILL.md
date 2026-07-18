---
name: vite-build
description: Configure and maintain a Vite frontend for a Tauri application with explicit environment, type checking, assets, and production-build behavior. Use for Vite config, scripts, aliases, plugins, or build failures.
---

# Vite Build

## Principles
- Preserve Vite defaults unless a measured requirement needs customization.
- Keep `vite.config.ts` typed.
- Treat client environment variables as public; never place secrets in them.
- Use one package manager and respect the lockfile.
- Keep aliases consistent with TypeScript resolution.
- Run `tsc --noEmit` or the repository type-check command separately.
- Avoid adding plugins for features already provided by the current Vite version.

## Tauri integration
- Keep development server host and port intentionally scoped.
- Ensure production asset paths work inside the Tauri webview.
- Do not depend on Node-only APIs in browser code.
- Verify frontend build output matches the Tauri configuration.
- Test clean builds without relying on stale generated assets.

## Performance
- Lazy-load genuinely separate features.
- Inspect large dependencies before manual chunking.
- Avoid premature bundler tuning.
- Keep source maps and diagnostics aligned with the release policy.

## Upgrade rule
Before changing Vite major versions, read the official migration guide and record behavior changes that affect config, plugins, or the Node baseline.

## Routing
Pair with `typescript-strict`; use `change-verification` for production builds.
