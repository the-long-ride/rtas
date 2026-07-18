---
name: change-verification
description: Verify Rust, Tauri, TypeScript, Vite, CSS, and packaging changes with evidence before declaring completion. Use after implementation, refactoring, migration, or release work.
---

# Change Verification

## Verify proportionally
Run the narrowest checks first, then broader gates:

```text
format → type/lint → focused tests → full tests → build → runtime smoke test
```

Use commands defined by the repository. Typical fallbacks:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
tsc --noEmit
npm run lint
npm run test
npm run build
```

## Runtime proof
For behavior crossing UI and Rust:
- Launch the actual Tauri application.
- Exercise success, empty, invalid, cancellation, and error paths.
- Confirm frontend-visible errors are useful and contain no secrets.
- Confirm CLI machine output remains parseable.
- Check keyboard use and narrow-window layout for UI changes.

## Reporting
Report:
- Commands run and their outcomes.
- Behavior manually exercised.
- Checks not run and the exact reason.
- Remaining risks.

## Rules
- Never claim a command passed if it was not run.
- Do not hide warnings.
- Do not weaken tests or lint rules just to pass.
- A successful build is not proof of correct runtime behavior.

## Routing
Usually the final skill. Pair with `tauri2-windows-nsis` for installer smoke tests.
