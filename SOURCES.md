# Sources and maintenance

## Original work

Router and application skills (`accessible-responsive-ui`, `app-engineering-router`,
`change-verification`, `cli-gui-service-bridge`, `css-design-system`, `frontend-visual-design`,
`mcp-rust-tools`, `repo-discovery-planning`, `rust-async`, `rust-cli`, `rust-core`,
`rust-errors-observability`, `rust-quality`, `tauri2-architecture`, `tauri2-ipc-security`,
`tauri2-windows-nsis`, `typescript-strict`, `vite-build`) are original to this package under the
MIT license.

## Vendored Rust rule corpus

The 265 detailed Rust rule files under
`skills/app-engineering-router/references/rust-rules/*.md` plus the index at
`skills/app-engineering-router/references/rust-rule-index.md` are vendored from
[`leonardomso/rust-skills`](https://github.com/leonardomso/rust-skills) v1.5.1, which is also MIT
licensed. The full upstream license text lives at
`skills/app-engineering-router/references/UPSTREAM-RUST-SKILLS-LICENSE`.

## Maintenance guidance

- Re-check official documentation before dependency upgrades or release work.
- Keep the router `SKILL.md` route table in sync with `ROUTING.md`. `rtas validate` checks that
  every backtotted route target names an existing skill folder and that every `ROUTING.md` entry
  matches the same set; any missing target or duplicate skill name is reported as an error.
- The CLI now installs atomically: a new tree is staged into a temporary directory, then renamed
  into place after moving the existing tree to a backup. If staging fails, the backup is restored.
- Shell and PowerShell installers delegate to `node dist/cli.js install --dest <path> --all`; run
  `npm install && npm run build` first if you check this repository out directly.
