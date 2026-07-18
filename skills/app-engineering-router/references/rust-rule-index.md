# Rust Rule Index

Vendored from `leonardomso/rust-skills` v1.5.1: 265 detailed rule files, MIT licensed. See `UPSTREAM-RUST-SKILLS-LICENSE`.

Read only category needed, then `rust-rules/<rule-id>.md`. Priority: CRITICAL > HIGH > MEDIUM > LOW > REFERENCE.

| Priority | Prefix | Category | Rules |
| --- | --- | --- | --- |
| CRITICAL | `own-` | Ownership and borrowing | 12 |
| CRITICAL | `err-` | Error handling | 12 |
| CRITICAL | `mem-` | Memory optimization | 17 |
| CRITICAL | `unsafe-` | Unsafe code | 7 |
| HIGH | `api-` | API design | 17 |
| HIGH | `async-` | Async/await | 18 |
| HIGH | `conc-` | Concurrency | 4 |
| HIGH | `opt-` | Compiler optimization | 12 |
| HIGH | `num-` | Numeric safety | 5 |
| MEDIUM | `type-` | Type safety | 13 |
| MEDIUM | `trait-` | Traits and generics | 6 |
| MEDIUM | `conv-` | Conversions | 3 |
| MEDIUM | `const-` | Const and compile-time | 4 |
| MEDIUM | `serde-` | Serde | 8 |
| MEDIUM | `pat-` | Pattern matching | 5 |
| MEDIUM | `macro-` | Macros | 8 |
| MEDIUM | `closure-` | Closures | 5 |
| MEDIUM | `coll-` | Collections | 4 |
| MEDIUM | `name-` | Naming | 16 |
| MEDIUM | `test-` | Testing | 15 |
| MEDIUM | `doc-` | Documentation | 12 |
| MEDIUM | `obs-` | Observability | 7 |
| MEDIUM | `perf-` | Performance patterns | 13 |
| LOW | `proj-` | Project structure | 14 |
| LOW | `lint-` | Clippy and linting | 13 |
| REFERENCE | `anti-` | Anti-patterns | 15 |

Task map: domain logic -> `own-`, `err-`, `type-`, `pat-`; APIs -> `api-`, `trait-`, `conv-`, `doc-`; async -> `async-`, `own-`, `conc-`; unsafe -> `unsafe-`, `type-`, `test-`; performance -> `mem-`, `opt-`, `perf-`; review -> `anti-`, `lint-`, plus task-specific category.

Use package CLI for discovery: `rtas rules async`; read exact content: `rtas rule async-no-lock-await`.
