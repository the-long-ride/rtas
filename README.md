# Rust + Tauri + TypeScript Agent Skills

An original, compact skill pack for building a Rust application with:

- A reusable Rust application core
- A CLI for humans, scripts, and AI agents
- A Tauri 2 desktop GUI
- A TypeScript + Vite frontend
- Token-efficient CSS and accessibility guidance
- Optional local service and MCP adapters
- Windows NSIS distribution

## Design goals

- **Progressive disclosure:** every specialist lives in its own small `SKILL.md`.
- **Minimal routing:** start with one skill; use two for a real boundary; cap at three.
- **Current architecture:** Tauri 2 terminology and permissions, strict TypeScript, and modern Vite/CSS.
- **Evidence over assumptions:** inspect repository versions and use official documentation for uncertain APIs.
- **Rust corpus:** 265 detailed, on-demand Rust rules from `leonardomso/rust-skills` v1.5.1, vendored under its MIT license; router and application skills remain original.

## Install

Install the npm package first:

```bash
npm install -g @the-long-ride/rust-tauri-agent-skills
```

This exposes the `rtas` command (also `rust-tauri-agent-skills`, `rust-tauri`, and `rtas-skills`).

Quick start:

```bash
rtas install
```

This installs one top-level `/rust-tauri` router skill into
`./.agents/skills/rust-tauri-agent-skills`. The specialist skills stay nested inside the router
package and are loaded on demand. Add `--global` to install into
`~/.agents/skills/rust-tauri-agent-skills` instead.

Without global install:

```bash
npx @the-long-ride/rust-tauri-agent-skills install
npx @the-long-ride/rust-tauri-agent-skills validate
```

The installer accepts an agent name (`claude`, `codex`, `copilot`, `gemini`, `github`,
`opencode`) and writes the single router skill to the conventional workspace-local directory for
that agent. If no agent is given it uses the default path shown above. Add `--global` to install to
the conventional global directory instead. You can still pass an explicit path as the destination
for agents that are not yet mapped.
Use `--all` only when you intentionally want every specialist skill exposed directly in the agent
skill directory.
Use project-local installs when the skill pack belongs to one repository; use global installs
when every workspace should be able to use it.
If you use `npx` instead of a globally installed `rtas`, run `npx @the-long-ride/rust-tauri-agent-skills`
followed by the same subcommand.

### Claude Code

Claude Code has native project and user skill directories.

Workspace install:

```bash
rtas install claude
```

Global install:

```bash
rtas install claude --global
```

Optional slash command install:

```bash
mkdir -p ".claude/commands"
cp "$(npm root -g)/@the-long-ride/rust-tauri-agent-skills/commands/rust-tauri.md" ".claude/commands/rust-tauri.md"
```

Then ask Claude Code to use `/rust-tauri`; the router loads the smallest relevant specialist set.

### Codex

Codex uses Agent Skills with `SKILL.md` frontmatter and can also use repository `AGENTS.md`
instructions. Install globally into your Codex skills directory, or install project-local and point
Codex at the repository instructions.

Workspace install:

```bash
rtas install codex
rtas rust-tauri on --workspace .
```

Global install:

```bash
rtas install codex --global
```

Workspace activation:

```bash
rtas rust-tauri on --workspace .
```

This writes a managed block to `AGENTS.md` so Codex loads `/rust-tauri` for Rust, Tauri,
TypeScript, Vite, MCP, packaging, and UI work.

### GitHub Copilot

Copilot does not load this package's skill folders as native skills. Use the same package by
installing the folders into the repository and adding a Copilot instruction file that tells Copilot
which router file to read.

Workspace install:

```bash
rtas install copilot
mkdir -p ".github"
```

Add this to `.github/copilot-instructions.md`:

```md
For Rust, Tauri 2, TypeScript, Vite, MCP, packaging, or UI work, read
`.github/agent-skills/rust-tauri/SKILL.md` first. Follow its routing table and load only
the selected specialist `SKILL.md` files. Do not paste or merge the whole skill pack into context.
```

Copilot cloud agent also reads repository `AGENTS.md`, so this command is useful there too:

```bash
rtas rust-tauri on --workspace .
```

### OpenCode

OpenCode supports project/global rules through `AGENTS.md` and supports Claude-compatible skills.

Workspace install:

```bash
rtas install claude
rtas rust-tauri on --workspace .
```

Global install:

```bash
rtas install claude --global
```

OpenCode users who prefer native OpenCode locations can install to those paths instead:

```bash
rtas install opencode
rtas install opencode --global
```

### Antigravity / Gemini CLI

Gemini CLI uses `GEMINI.md` for hierarchical memory and supports agent skills from `.gemini/skills`.
Use the same skill folders there.

Workspace install:

```bash
rtas install gemini
```

Global install:

```bash
rtas install gemini --global
```

Add this to `GEMINI.md` in the workspace root, or to `$HOME/.gemini/GEMINI.md` for global use:

```md
For Rust, Tauri 2, TypeScript, Vite, MCP, packaging, or UI work, activate or read the
`rust-tauri` skill first. Follow its routing table and load only the selected specialist
`SKILL.md` files. Keep the Rust rule corpus on demand through `references/rust-rule-index.md`.
```

Reload in Gemini CLI:

```text
/memory reload
/skills reload
```

Validate the packaged skill set:

```bash
rtas validate
```

List included skills:

```bash
rtas list
```

Search and read the full Rust corpus without loading it all into context:

```bash
rtas rules async
rtas rule async-no-lock-await
```

Use the slash command flow from an AI-agent chat:

```text
/rust-tauri
/rust-tauri On
/rust-tauri Off
```

The package includes `commands/rust-tauri.md` for agents that load slash-command files. The CLI also supports workspace-local ON/OFF state:

```bash
rtas rust-tauri on --workspace .
rtas rust-tauri status --workspace .
rtas rust-tauri off --workspace .
```

`On` writes only a managed block in the target workspace `AGENTS.md` plus `.rust-tauri-agent-skills/state.json`. `Off` removes that managed block. Other workspaces are unchanged.

Build and pack locally:

```bash
npm install
npm run build
npm pack --dry-run
```

Legacy direct-copy scripts are still available. They copy every folder under `skills/`; use them only
when you intentionally want every specialist exposed directly.

Copy the folders under `skills/` into the skills directory supported by your agent.

PowerShell:

```powershell
./install.ps1 -Destination "$HOME/.claude/skills"
```

Shell:

```bash
./install.sh "$HOME/.claude/skills"
```

You can choose a project-local destination instead. The scripts only copy directories and never delete existing skills unless `-Force`/`--force` is supplied.

## Start

Load or enable `/rust-tauri`. It routes work to the smallest relevant specialist set.

Examples:

```text
Implement a new Tauri command for content generation.
Use `/rust-tauri` and follow the selected skills.

Move the existing worker into a CLI service used by Tauri and MCP.
Route this task, then implement one vertical slice and verify it.

Redesign the settings screen without changing behavior.
Route to the visual, CSS, and accessibility skills.
```

## Structure

See `ROUTING.md` for the compact routing table and `MANIFEST.csv` for approximate size information.

## Node.js and TypeScript

This repository is packaged as a Node.js ESM CLI written in TypeScript 7. The compiled entry points live in `dist/` after `npm run build`; the npm tarball includes `dist/`, `skills/`, and the documentation needed to use the pack.

## Project-specific customization

After installing, adapt these items to your repository:

- Actual crate and package names
- Exact build/test/lint commands
- Current protocol version and transport
- Existing UI framework and state library
- Installer naming and PATH policy
- Required Tauri capabilities
- Release signing and updater policy

Keep project-specific facts in your repository instructions (`AGENTS.md`, `CLAUDE.md`, or equivalent), not duplicated across every skill.

## Sources and maintenance

See `SOURCES.md`. Upstream rule license lives at `skills/app-engineering-router/references/UPSTREAM-RUST-SKILLS-LICENSE`. Re-check official documentation before dependency upgrades or release work.
