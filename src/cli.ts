#!/usr/bin/env node
import {
  findRustRules,
  getRustTauriWorkspaceMode,
  installRouterSkill,
  installSkills,
  listRustRules,
  readRustRule,
  listSkills,
  resolveAgentDestination,
  resolveDefaultDestination,
  setRustTauriWorkspaceMode,
  validateSkills,
} from "./index.js";

const [, , rawCommand, ...rawArgs] = process.argv;
const aliasCommand = rawCommand === "on" || rawCommand === "off" || rawCommand === "status";
const command = aliasCommand ? "rust-tauri" : rawCommand;
const args = aliasCommand ? [rawCommand, ...rawArgs] : rawArgs;

try {
  switch (command) {
    case "install": {
      const global = args.includes("--global") || args.includes("-g");
      const destArg = args.find((arg) => !arg.startsWith("-"));
      const destination = resolveInstallDestination(destArg, global);

      const force = args.includes("--force");
      const all = args.includes("--all");
      const result = all
        ? await installSkills(destination, { force })
        : await installRouterSkill(destination, { force });
      for (const name of result.installed) {
        console.log(`Installed ${name}`);
      }
      for (const name of result.skipped) {
        const kind = all ? "skill" : "router";
        console.warn(`Skipping existing ${kind}: ${name} (use --force to replace)`);
      }
      break;
    }
    case "list": {
      for (const skill of await listSkills()) {
        console.log(`${skill.name}\t${skill.description}`);
      }
      break;
    }
    case "validate": {
      const result = await validateSkills();
      if (result.errors.length > 0) {
        console.error(result.errors.join("\n"));
        process.exit(1);
      }
      console.log(`Validated ${result.count} skills.`);
      break;
    }
    case "rules": {
      const query = args[0] === "list" ? args[1] : args[0];
      const rules = query ? await findRustRules(query) : await listRustRules();
      for (const rule of rules) {
        console.log(`${rule.id}\t${rule.summary}`);
      }
      break;
    }
    case "rule": {
      const ruleId = args.find((arg) => !arg.startsWith("-"));
      if (!ruleId) {
        usage(2);
      }
      process.stdout.write(await readRustRule(ruleId));
      break;
    }
    case "rust-tauri":
    case "/rust-tauri": {
      const mode = args.find((arg) => !arg.startsWith("-"))?.toLowerCase();
      const workspace = getOptionValue(args, "--workspace") ?? process.cwd();

      if (mode === "on") {
        const result = await setRustTauriWorkspaceMode(workspace, true);
        console.log(`Rust Tauri skills ON for ${result.workspace}`);
        console.log(`Updated ${result.agentsPath}`);
      } else if (mode === "off") {
        const result = await setRustTauriWorkspaceMode(workspace, false);
        console.log(`Rust Tauri skills OFF for ${result.workspace}`);
        console.log(`Updated ${result.agentsPath}`);
      } else if (mode === "status" || mode === undefined) {
        const result = await getRustTauriWorkspaceMode(workspace);
        console.log(`Rust Tauri skills ${result.enabled ? "ON" : "OFF"} for ${result.workspace}`);
      } else {
        console.error(`Unknown /rust-tauri mode: ${mode}`);
        usage(2);
      }
      break;
    }
    case "--help":
    case "-h":
    case undefined:
      usage(0);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      usage(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function usage(exitCode: number): never {
  console.log(`Usage:
  rtas install [AGENT] [--global] [--force] [--all]
  rtas install DESTINATION_PATH [--force] [--all]
  rtas list
  rtas validate
  rtas rules [QUERY]
  rtas rule RULE_ID
  rtas rust-tauri [on|off|status] [--workspace DIR]
  rtas [on|off|status] [--workspace DIR]

Default install: ./.agents/skills/rust-tauri-agent-skills  (or ~/.agents/skills/rust-tauri-agent-skills with --global)
Agents: claude, codex, copilot, gemini, github, opencode
Also works as: rust-tauri-agent-skills, rust-tauri, rtas-skills`);
  process.exit(exitCode);
}

function getOptionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function resolveInstallDestination(destArg: string | undefined, global: boolean): string {
  if (!destArg) {
    return resolveDefaultDestination(global);
  }
  try {
    return resolveAgentDestination(destArg, global);
  } catch {
    return destArg;
  }
}
