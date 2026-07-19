#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { findRustRules, getRustTauriWorkspaceMode, installRouterSkill, installSkills, listRustRules, readRustRule, listSkills, recoverInterruptedInstalls, resolveAgentDestination, resolveDefaultDestination, setRustTauriWorkspaceMode, suggestAgent, validateSkills, } from "./index.js";
const SUPPORTED_AGENTS = ["claude", "codex", "copilot", "gemini", "github", "opencode"];
const [, , rawCommand, ...rawArgs] = process.argv;
const aliasCommand = rawCommand === "on" || rawCommand === "off" || rawCommand === "status";
const command = aliasCommand ? "rust-tauri" : rawCommand;
const args = aliasCommand ? [rawCommand, ...rawArgs] : rawArgs;
try {
    switch (command) {
        case "install":
            await runInstall(args);
            break;
        case "recover":
            await runRecover(args);
            break;
        case "list":
            for (const skill of await listSkills()) {
                console.log(`${skill.name}\t${skill.description}`);
            }
            break;
        case "validate":
            await runValidate(args);
            break;
        case "rules":
            await runRules(args);
            break;
        case "rule":
            await runRule(args);
            break;
        case "rust-tauri":
        case "/rust-tauri":
            await runRustTauri(args);
            break;
        case "--help":
        case "-h":
        case undefined:
            usage(0);
            break;
        default:
            console.error(`Unknown command: ${command}`);
            usage(2);
    }
}
catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
function usage(exitCode) {
    console.log(`Usage:
  rtas install [AGENT] [--global] [--force] [--all]
  rtas install --dest DESTINATION_PATH [--global] [--force] [--all]
  rtas recover [--dest DESTINATION_PATH | AGENT] [--global]
  rtas list
  rtas validate
  rtas rules [QUERY]
  rtas rule RULE_ID
  rtas rust-tauri [on|off|status] [--workspace DIR]
  rtas [on|off|status] [--workspace DIR]

Default install: ./.agents/skills/rust-tauri-agent-skills  (or ~/.agents/skills/rust-tauri-agent-skills with --global)
Agents: claude, codex, copilot, gemini, github, opencode
Use --dest <path> to install to a custom filesystem path instead of an agent name.
Unknown agent names are rejected with a suggestion; pass --dest for custom paths.
Also works as: rust-tauri-agent-skills, rust-tauri, rtas-skills`);
    process.exit(exitCode);
}
async function runInstall(args) {
    const { values, positionals } = parseArgs({
        options: {
            global: { type: "boolean", short: "g" },
            force: { type: "boolean" },
            all: { type: "boolean" },
            dest: { type: "string" },
        },
        allowPositionals: true,
        strict: true,
        args,
    });
    if (positionals.length > 1) {
        throw new Error(`Unexpected positional arguments: ${positionals.slice(1).join(" ")}`);
    }
    if (values.dest !== undefined && positionals.length > 0) {
        throw new Error("Pass either an agent name or --dest <path>, not both.");
    }
    if (values.dest !== undefined && values.global) {
        throw new Error("--global cannot be combined with --dest <path>.");
    }
    const force = values.force === true;
    const all = values.all === true;
    const destination = resolveInstallDestination(positionals[0], values.dest, values.global === true);
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
}
async function runRecover(args) {
    const { values, positionals } = parseArgs({
        options: {
            global: { type: "boolean", short: "g" },
            dest: { type: "string" },
        },
        allowPositionals: true,
        strict: true,
        args,
    });
    if (positionals.length > 1) {
        throw new Error(`Unexpected positional arguments: ${positionals.slice(1).join(" ")}`);
    }
    if (values.dest !== undefined && positionals.length > 0) {
        throw new Error("Pass either an agent name or --dest <path>, not both.");
    }
    if (values.dest !== undefined && values.global) {
        throw new Error("--global cannot be combined with --dest <path>.");
    }
    const parentDir = parentOfInstallDestination(positionals[0], values.dest, values.global === true);
    const messages = await recoverInterruptedInstalls(parentDir);
    if (messages.length === 0) {
        console.log("No interrupted installs found.");
    }
    else {
        for (const message of messages) {
            console.log(message);
        }
    }
}
async function runValidate(args) {
    const { positionals } = parseArgs({
        options: {},
        allowPositionals: true,
        strict: true,
        args,
    });
    if (positionals.length > 0) {
        throw new Error(`Unexpected positional arguments: ${positionals.join(" ")}`);
    }
    const result = await validateSkills();
    if (result.errors.length > 0) {
        console.error(result.errors.join("\n"));
        process.exit(1);
    }
    console.log(`Validated ${result.count} skills.`);
}
async function runRules(args) {
    const { positionals } = parseArgs({
        options: {},
        allowPositionals: true,
        strict: true,
        args,
    });
    if (positionals.length > 1) {
        throw new Error(`Unexpected positional arguments: ${positionals.slice(1).join(" ")}`);
    }
    if (positionals[0] === "list") {
        for (const rule of await listRustRules()) {
            console.log(`${rule.id}\t${rule.summary}`);
        }
        return;
    }
    const query = positionals[0];
    const rules = query ? await findRustRules(query) : await listRustRules();
    for (const rule of rules) {
        console.log(`${rule.id}\t${rule.summary}`);
    }
}
async function runRule(args) {
    const { positionals } = parseArgs({
        options: {},
        allowPositionals: true,
        strict: true,
        args,
    });
    if (positionals.length === 0) {
        usage(2);
    }
    if (positionals.length > 1) {
        throw new Error(`Unexpected positional arguments: ${positionals.slice(1).join(" ")}`);
    }
    const ruleId = positionals[0];
    if (!ruleId) {
        usage(2);
    }
    process.stdout.write(await readRustRule(ruleId));
}
async function runRustTauri(args) {
    let values = {};
    let positionals = [];
    try {
        const parsed = parseArgs({
            options: {
                workspace: { type: "string" },
            },
            allowPositionals: true,
            strict: true,
            args,
        });
        values = parsed.values;
        positionals = parsed.positionals;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("--workspace")) {
            throw new Error(`Missing value for --workspace`);
        }
        throw error;
    }
    if (positionals.length > 1) {
        throw new Error(`Unexpected positional arguments: ${positionals.slice(1).join(" ")}`);
    }
    const mode = positionals[0]?.toLowerCase();
    const workspace = values.workspace ?? process.cwd();
    if (mode === "on") {
        const result = await setRustTauriWorkspaceMode(workspace, true);
        console.log(`Rust Tauri skills ON for ${result.workspace}`);
        console.log(`Updated ${result.agentsPath}`);
    }
    else if (mode === "off") {
        const result = await setRustTauriWorkspaceMode(workspace, false);
        console.log(`Rust Tauri skills OFF for ${result.workspace}`);
        console.log(`Updated ${result.agentsPath}`);
    }
    else if (mode === "status" || mode === undefined) {
        const result = await getRustTauriWorkspaceMode(workspace);
        console.log(`Rust Tauri skills ${result.enabled ? "ON" : "OFF"} for ${result.workspace}`);
    }
    else {
        throw new Error(`Unknown /rust-tauri mode: ${mode}`);
    }
}
function resolveInstallDestination(positional, destFlag, global) {
    if (destFlag !== undefined) {
        return resolve(destFlag);
    }
    if (!positional) {
        return resolveDefaultDestination(global);
    }
    if (!isSupportedAgent(positional)) {
        const suggestion = suggestAgent(positional);
        const hint = suggestion
            ? ` Did you mean "${suggestion}"? Use --dest <path> to install to a custom filesystem path.`
            : " Use --dest <path> to install to a custom filesystem path.";
        throw new Error(`Unknown agent: ${positional}. Supported agents: ${SUPPORTED_AGENTS.join(", ")}.${hint}`);
    }
    return resolveAgentDestination(positional, global);
}
function parentOfInstallDestination(positional, destFlag, global) {
    if (destFlag !== undefined) {
        return resolve(destFlag);
    }
    if (!positional) {
        return resolve(resolveDefaultDestination(global));
    }
    if (!isSupportedAgent(positional)) {
        const suggestion = suggestAgent(positional);
        const hint = suggestion ? ` Did you mean "${suggestion}"?` : "";
        throw new Error(`Unknown agent: ${positional}. Supported agents: ${SUPPORTED_AGENTS.join(", ")}.${hint}`);
    }
    return resolveAgentDestination(positional, global);
}
function isSupportedAgent(value) {
    return SUPPORTED_AGENTS.includes(value.toLowerCase());
}
