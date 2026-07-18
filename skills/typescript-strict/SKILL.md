---
name: typescript-strict
description: Write strict, maintainable TypeScript for Tauri/Vite frontends with validated boundaries and exhaustive state handling. Use for frontend logic, DTOs, API wrappers, and refactoring.
---

# Strict TypeScript

## Types
- Keep strict mode enabled.
- Avoid `any`; use `unknown` and narrow at boundaries.
- Model states with discriminated unions.
- Make impossible combinations unrepresentable.
- Prefer readonly inputs and immutable updates.
- Use exhaustive checks for unions.
- Distinguish missing, optional, null, empty, and unavailable.

## Boundaries
- Centralize Tauri invocation wrappers.
- Type requests, successful responses, and errors.
- Validate data that is external, persisted, versioned, or not controlled by the current build.
- Do not cast merely to silence the compiler.
- Keep domain transformations outside UI components.

## Components
- Keep rendering pure where possible.
- Separate server/application state, local UI state, and derived state.
- Avoid effects for values that can be computed.
- Clean up subscriptions, timers, channels, and listeners.
- Represent loading, empty, error, success, and cancellation deliberately.

## Verification
Run TypeScript checking independently of the Vite transform because transpilation is not type checking.

## Routing
Pair with `tauri2-ipc-security` for cross-language contracts or `vite-build` for tooling.
