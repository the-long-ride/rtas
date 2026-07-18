---
name: rust-quality
description: Add focused Rust tests and enforce formatting, linting, dependency, and CI quality gates. Use for feature completion, refactoring, regression prevention, and review.
---

# Rust Quality

## Test strategy
- Unit-test pure invariants and transformations.
- Integration-test public crate or application-service behavior.
- Contract-test adapters and serialized DTOs.
- Add regression tests before fixing reproducible defects.
- Use temporary directories and deterministic fixtures.
- Avoid sleeps for synchronization; wait on explicit signals or bounded polling.

## Quality gates
Use repository commands. Typical strict gates:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
cargo build --workspace --release
```

Run optional tools only when present in the repository, such as `cargo nextest`, audit, deny, coverage, or mutation testing.

## Review
Reject:
- New `unwrap`/`expect` on reachable input paths.
- Tests that only duplicate implementation.
- Disabled lints without a local rationale.
- Public API growth without need.
- Snapshot updates that were not inspected.

## Routing
Pair with one Rust implementation skill. Use `change-verification` for cross-language or runtime proof.
