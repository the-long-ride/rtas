import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

export interface SkillSummary {
  name: string;
  description: string;
  path: string;
}

export interface InstallOptions {
  force?: boolean;
}

export interface InstallResult {
  installed: string[];
  skipped: string[];
}

export interface ValidationResult {
  count: number;
  errors: string[];
}

export interface RustRuleSummary {
  id: string;
  path: string;
  summary: string;
}

export interface WorkspaceToggleResult {
  agentsPath: string;
  enabled: boolean;
  statePath: string;
  workspace: string;
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const routerSourceName = "app-engineering-router";
const installedRouterName = "rust-tauri";
const managedBlockStart = "<!-- rust-tauri-agent-skills:start -->";
const managedBlockEnd = "<!-- rust-tauri-agent-skills:end -->";
const skillNamePattern = /^[a-z0-9-]+$/;
const routerRoutePattern = /`([a-z0-9-]+)`/g;

export const AGENT_DIRS: Record<string, { local: string; global: string }> = {
  claude: { local: ".claude/skills", global: ".claude/skills" },
  codex: { local: ".codex/agent-skills", global: ".codex/agent-skills" },
  copilot: { local: ".github/agent-skills", global: ".github/agent-skills" },
  gemini: { local: ".gemini/skills", global: ".gemini/skills" },
  github: { local: ".github/agent-skills", global: ".github/agent-skills" },
  opencode: { local: ".opencode/skills", global: ".opencode/skills" },
} as const;

export function resolveAgentDestination(
  agentOrPath: string,
  global = false,
  workspace = process.cwd(),
): string {
  const agent = agentOrPath.toLowerCase();
  const entry = AGENT_DIRS[agent];
  if (!entry) {
    throw new Error(
      `Unknown agent: ${agentOrPath}. Supported agents: ${getSupportedAgents().join(", ")}`,
    );
  }

  const relPath = global ? entry.global : entry.local;
  return global ? resolve(homedir(), relPath) : resolve(workspace, relPath);
}

export function getSupportedAgents(): string[] {
  return Object.keys(AGENT_DIRS).sort();
}

export function resolveDefaultDestination(
  global = false,
  workspace = process.cwd(),
): string {
  const relPath = ".agents/skills/rust-tauri-agent-skills";
  return global ? resolve(homedir(), relPath) : resolve(workspace, relPath);
}

export function suggestAgent(input: string): string | undefined {
  const normalized = input.toLowerCase();
  const agents = getSupportedAgents();
  const exact = agents.find((agent) => agent === normalized);
  if (exact) {
    return exact;
  }

  const byPrefix = agents.find((agent) => agent.startsWith(normalized));
  if (byPrefix) {
    return byPrefix;
  }

  const byLevenshtein = agents
    .map((agent) => ({ agent, distance: levenshtein(normalized, agent) }))
    .filter((entry) => entry.distance <= 2)
    .sort((left, right) => left.distance - right.distance)[0];
  return byLevenshtein?.agent;
}

export function getPackageRoot(): string {
  return projectRoot;
}

export function getSkillsDir(): string {
  return join(projectRoot, "skills");
}

export function getRustRulesDir(): string {
  return join(getSkillsDir(), "app-engineering-router", "references", "rust-rules");
}

export async function listRustRules(rulesDir = getRustRulesDir()): Promise<RustRuleSummary[]> {
  const entries = await readdir(rulesDir, { withFileTypes: true });
  const rules = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && extname(entry.name) === ".md")
      .map(async (entry) => {
        const path = join(rulesDir, entry.name);
        return {
          id: basename(entry.name, ".md"),
          path,
          summary: parseRustRuleSummary(await readFile(path, "utf8")),
        };
      }),
  );

  return rules.sort((left, right) => left.id.localeCompare(right.id));
}

export async function findRustRules(query: string, rulesDir = getRustRulesDir()): Promise<RustRuleSummary[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return listRustRules(rulesDir);
  }

  return (await listRustRules(rulesDir)).filter(
    (rule) => rule.id.includes(normalized) || rule.summary.toLowerCase().includes(normalized),
  );
}

export async function readRustRule(ruleId: string, rulesDir = getRustRulesDir()): Promise<string> {
  if (!skillNamePattern.test(ruleId)) {
    throw new Error(`Invalid Rust rule ID: ${ruleId}`);
  }

  return readFile(join(rulesDir, `${ruleId}.md`), "utf8");
}

export async function listSkills(skillsDir = getSkillsDir()): Promise<SkillSummary[]> {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => readSkillSummary(entry.name, join(skillsDir, entry.name, "SKILL.md"))),
  );

  return summaries.sort((left, right) => left.name.localeCompare(right.name));
}

export async function readSkillSummary(folder: string, filePath: string): Promise<SkillSummary> {
  const text = await readFile(filePath, "utf8");
  const parsed = parseSkillFrontmatter(text);

  return {
    name: parsed.name ?? folder,
    description: parsed.description ?? "",
    path: filePath,
  };
}

export async function installSkills(
  destination: string,
  options: InstallOptions = {},
  skillsDir = getSkillsDir(),
): Promise<InstallResult> {
  await mkdir(destination, { recursive: true });

  const installed: string[] = [];
  const skipped: string[] = [];

  for (const skill of await listSkills(skillsDir)) {
    const skillFolder = basename(dirname(skill.path));
    const target = join(destination, skillFolder);
    const source = join(skillsDir, skillFolder);
    if (await pathExists(target)) {
      if (options.force !== true) {
        skipped.push(skillFolder);
        continue;
      }
    }

    await atomicStageCopy(source, target, { force: options.force === true });
    installed.push(skillFolder);
  }

  return { installed, skipped };
}

export async function installRouterSkill(
  destination: string,
  options: InstallOptions = {},
  skillsDir = getSkillsDir(),
): Promise<InstallResult> {
  await mkdir(destination, { recursive: true });

  const target = join(destination, installedRouterName);
  if (await pathExists(target)) {
    if (options.force !== true) {
      return { installed: [], skipped: [installedRouterName] };
    }
  }

  const routerSource = join(skillsDir, routerSourceName);
  const routerText = await readFile(join(routerSource, "SKILL.md"), "utf8");
  const installedRouterText = routerText.replace(
    /^---\r?\nname:\s*[a-z0-9-]+/,
    `---\nname: ${installedRouterName}`,
  );

  await atomicStage((stagedDir) => copyRouterTree(routerSource, stagedDir, installedRouterText), target, {
    force: options.force === true,
  });

  return { installed: [installedRouterName], skipped: [] };
}

export async function validateSkills(skillsDir = getSkillsDir()): Promise<ValidationResult> {
  const errors: string[] = [];
  const seenNames = new Map<string, string>();
  const folderEntries = await readdir(skillsDir, { withFileTypes: true });
  const folders = folderEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const skills: SkillSummary[] = [];

  for (const folder of folders) {
    const skillPath = join(skillsDir, folder, "SKILL.md");
    if (!(await pathExists(skillPath))) {
      errors.push(`${join(skillsDir, folder)}: SKILL.md missing`);
      continue;
    }

    const text = await readFile(skillPath, "utf8");
    const parsed = parseSkillFrontmatter(text);
    const body = parsed.body ?? "";

    if (!parsed.valid) {
      errors.push(`${skillPath}: invalid frontmatter`);
      continue;
    }
    if (!skillNamePattern.test(parsed.name)) {
      errors.push(`${skillPath}: name ${JSON.stringify(parsed.name)} must match ${skillNamePattern.source}`);
    }
    if (parsed.name !== folder) {
      errors.push(`${skillPath}: name ${JSON.stringify(parsed.name)} does not match folder ${JSON.stringify(folder)}`);
    }
    if (parsed.name.length > 64) {
      errors.push(`${skillPath}: name exceeds 64 characters`);
    }
    if (parsed.description.length > 1024) {
      errors.push(`${skillPath}: description exceeds 1024 characters`);
    }
    if (body.split(/\r?\n/).length > 500) {
      errors.push(`${skillPath}: body exceeds 500 lines`);
    }
    if (body.trim().split(/\s+/).filter(Boolean).length > 500) {
      errors.push(`${skillPath}: body exceeds compact-pack limit of 500 words`);
    }

    const previous = seenNames.get(parsed.name);
    if (previous) {
      errors.push(`${skillPath}: duplicate skill name ${JSON.stringify(parsed.name)} (also declared in ${previous})`);
    } else {
      seenNames.set(parsed.name, skillPath);
      skills.push({ name: parsed.name, description: parsed.description, path: skillPath });
    }
  }

  errors.push(...(await validateRouterTargets(skillsDir, skills)));
  errors.push(...(await validateRoutingTable(skillsDir, skills)));

  return { count: skills.length, errors };
}

export async function setRustTauriWorkspaceMode(
  workspace = process.cwd(),
  enabled: boolean,
): Promise<WorkspaceToggleResult> {
  const target = resolve(workspace);
  const stateDir = join(target, ".rust-tauri-agent-skills");
  const statePath = join(stateDir, "state.json");
  const agentsPath = join(target, "AGENTS.md");
  const previousAgents = await readOptionalText(agentsPath);
  const nextAgents = enabled
    ? upsertManagedBlock(previousAgents, workspaceInstructionBlock())
    : removeManagedBlock(previousAgents);

  await mkdir(stateDir, { recursive: true });

  let agentsCommitted = false;
  try {
    if (nextAgents.trim().length === 0) {
      if ((await pathExists(agentsPath))) {
        await rm(agentsPath, { force: true });
      }
    } else {
      await atomicWriteText(agentsPath, nextAgents);
    }
    agentsCommitted = true;

    const stateText = `${JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2)}\n`;
    await atomicWriteText(statePath, stateText);
  } catch (error) {
    if (agentsCommitted) {
      try {
        if (previousAgents.trim().length === 0) {
          await rm(agentsPath, { force: true });
        } else {
          await atomicWriteText(agentsPath, previousAgents);
        }
      } catch {
        // Best-effort rollback; surface original error to the caller.
      }
    }
    throw error;
  }

  return { agentsPath, enabled, statePath, workspace: target };
}

export async function getRustTauriWorkspaceMode(workspace = process.cwd()): Promise<WorkspaceToggleResult> {
  const target = resolve(workspace);
  const statePath = join(target, ".rust-tauri-agent-skills", "state.json");
  const agentsPath = join(target, "AGENTS.md");
  const stateText = await readOptionalText(statePath);
  const agentsText = await readOptionalText(agentsPath);
  let enabled = agentsText.includes(managedBlockStart) && agentsText.includes(managedBlockEnd);

  if (stateText.trim().length > 0) {
    try {
      const parsed = JSON.parse(stateText) as { enabled?: unknown };
      enabled = parsed.enabled === true && enabled;
    } catch {
      enabled = false;
    }
  }

  return { agentsPath, enabled, statePath, workspace: target };
}

interface ParsedFrontmatter {
  body?: string;
  description: string;
  name: string;
  valid: boolean;
}

function parseSkillFrontmatter(text: string): ParsedFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) {
    return { description: "", name: "", valid: false };
  }

  const frontmatterText = match[1] ?? "";
  let parsed: unknown;
  try {
    parsed = YAML.parse(frontmatterText);
  } catch {
    return { description: "", name: "", valid: false };
  }

  if (!parsed || typeof parsed !== "object") {
    return { description: "", name: "", valid: false };
  }

  const record = parsed as Record<string, unknown>;
  const rawName = record.name;
  const rawDescription = record.description;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  const description = typeof rawDescription === "string" ? rawDescription.trim() : "";
  if (!name || !description) {
    return { description, name, valid: false };
  }

  return {
    body: text.slice(match[0].length),
    description,
    name,
    valid: true,
  };
}

function parseRustRuleSummary(text: string): string {
  return /^# [^\r\n]+\r?\n\r?\n>\s+(.+)$/m.exec(text)?.[1]?.trim() ?? "";
}

async function copyRouterTree(routerSource: string, stagedDir: string, installedRouterText: string): Promise<void> {
  await mkdir(join(stagedDir, "skills"), { recursive: true });
  await writeFile(join(stagedDir, "SKILL.md"), installedRouterText, "utf8");
  await cp(join(routerSource, "references"), join(stagedDir, "references"), {
    recursive: true,
    force: true,
  });

  const skillsDir = dirname(routerSource);
  for (const skill of await listSkills(skillsDir)) {
    const skillFolder = basename(dirname(skill.path));
    if (skillFolder === routerSourceName) {
      continue;
    }
    await cp(join(skillsDir, skillFolder), join(stagedDir, "skills", skillFolder), {
      recursive: true,
      force: true,
    });
  }
}

async function atomicStageCopy(
  source: string,
  target: string,
  options: { force: boolean },
): Promise<void> {
  await atomicStage((stagedDir) => cp(source, stagedDir, { recursive: true, force: true }), target, options);
}

async function atomicStage(
  stage: (stagedDir: string) => Promise<void>,
  target: string,
  options: { force: boolean },
): Promise<void> {
  const parent = dirname(target);
  const base = basename(target);
  const staged = join(parent, `.${base}.rtas-stage.${process.pid}`);
  const backup = join(parent, `.${base}.rtas-bak`);

  await rm(staged, { recursive: true, force: true });

  try {
    await mkdir(parent, { recursive: true });
    await stage(staged);
    const targetExists = await pathExists(target);
    if (targetExists && !options.force) {
      throw new Error(`Destination already exists: ${target}`);
    }
    if (targetExists) {
      await rm(backup, { recursive: true, force: true });
      await rename(target, backup);
    }
    await rename(staged, target);
    if (targetExists) {
      await rm(backup, { recursive: true, force: true });
    }
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    try {
      if (await pathExists(backup)) {
        if (!(await pathExists(target))) {
          await rename(backup, target);
        } else {
          await rm(backup, { recursive: true, force: true });
        }
      }
    } catch {
      // Best-effort rollback; original error is the one callers must see.
    }
    throw error;
  }
}

async function atomicWriteText(path: string, text: string): Promise<void> {
  const staged = `${path}.rtas-stage.${process.pid}`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(staged, text, "utf8");
    await rename(staged, path);
  } catch (error) {
    await rm(staged, { force: true });
    throw error;
  }
}

async function validateRouterTargets(
  skillsDir: string,
  skills: SkillSummary[],
): Promise<string[]> {
  const errors: string[] = [];
  const routerPath = join(skillsDir, routerSourceName, "SKILL.md");
  if (!(await pathExists(routerPath))) {
    errors.push(`${routerPath}: router skill missing`);
    return errors;
  }

  const routerText = await readFile(routerPath, "utf8");
  const referenced = new Set<string>();
  for (const match of routerText.matchAll(routerRoutePattern)) {
    const id = match[1];
    if (id) {
      referenced.add(id);
    }
  }

  const known = new Set(skills.map((skill) => skill.name));
  for (const id of referenced) {
    if (!known.has(id)) {
      errors.push(`${routerPath}: route target ${JSON.stringify(id)} does not match any skill folder`);
    }
  }

  return errors;
}

async function validateRoutingTable(
  _skillsDir: string,
  skills: SkillSummary[],
): Promise<string[]> {
  const errors: string[] = [];
  const routingPath = join(projectRoot, "ROUTING.md");
  if (!(await pathExists(routingPath))) {
    return errors;
  }

  const routingText = await readFile(routingPath, "utf8");
  const known = new Set(skills.map((skill) => skill.name));
  const referenced = new Set<string>();
  for (const match of routingText.matchAll(routerRoutePattern)) {
    const id = match[1];
    if (id) {
      referenced.add(id);
    }
  }

  for (const id of referenced) {
    if (!known.has(id)) {
      errors.push(`${routingPath}: routing target ${JSON.stringify(id)} does not match any skill folder`);
    }
  }

  return errors;
}

function levenshtein(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  let previous = new Array(right.length + 1);
  let current = new Array(right.length + 1);
  for (let j = 0; j <= right.length; j++) {
    previous[j] = j;
  }

  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }

  return previous[right.length];
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
    return false;
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
    return false;
  }
}

async function readOptionalText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return "";
    }
    throw error;
  }
}

function upsertManagedBlock(text: string, block: string): string {
  const stripped = removeManagedBlock(text).trimEnd();
  return `${stripped}${stripped ? "\n\n" : ""}${block}\n`;
}

function removeManagedBlock(text: string): string {
  const pattern = new RegExp(`${escapeRegExp(managedBlockStart)}[\\s\\S]*?${escapeRegExp(managedBlockEnd)}\\n?`, "g");
  return text.replace(pattern, "").trimEnd() + (text.trim().length > 0 ? "\n" : "");
}

function workspaceInstructionBlock(): string {
  return `${managedBlockStart}
# Rust Tauri Agent Skills

For Rust, Tauri 2, TypeScript, Vite, MCP, packaging, or UI work in this workspace:
- Treat \`/rust-tauri\` as the request to load the package router.
- If \`/rust-tauri\` is not available as a native skill, read the first existing local router:
  \`.agents/skills/rust-tauri-agent-skills/rust-tauri/SKILL.md\`,
  \`.claude/skills/rust-tauri/SKILL.md\`,
  \`.codex/agent-skills/rust-tauri/SKILL.md\`,
  \`.github/agent-skills/rust-tauri/SKILL.md\`,
  \`.gemini/skills/rust-tauri/SKILL.md\`,
  \`.opencode/skills/rust-tauri/SKILL.md\`.
- Use the router first, then load only selected specialist \`SKILL.md\` files.
- Keep context split; do not merge all skill guidance into one prompt.
- Use \`/rust-tauri Off\` or \`rtas rust-tauri off\` to remove this workspace-local block.
${managedBlockEnd}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
