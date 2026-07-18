import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  if (!/^[a-z0-9-]+$/.test(ruleId)) {
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
    if (await prepareInstallTarget(target, options.force === true)) {
      skipped.push(skillFolder);
      continue;
    }

    await cp(join(skillsDir, skillFolder), target, { recursive: true, force: true });
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
  if (await prepareInstallTarget(target, options.force === true)) {
    return { installed: [], skipped: [installedRouterName] };
  }

  const routerSource = join(skillsDir, routerSourceName);
  const routerText = await readFile(join(routerSource, "SKILL.md"), "utf8");
  const installedRouterText = routerText.replace(
    /^---\r?\nname:\s*[a-z0-9-]+/,
    `---\nname: ${installedRouterName}`,
  );
  await mkdir(join(target, "skills"), { recursive: true });
  await writeFile(join(target, "SKILL.md"), installedRouterText, "utf8");
  await cp(join(routerSource, "references"), join(target, "references"), {
    recursive: true,
    force: true,
  });

  for (const skill of await listSkills(skillsDir)) {
    const skillFolder = basename(dirname(skill.path));
    if (skillFolder === routerSourceName) {
      continue;
    }
    await cp(join(skillsDir, skillFolder), join(target, "skills", skillFolder), {
      recursive: true,
      force: true,
    });
  }

  return { installed: [installedRouterName], skipped: [] };
}

export async function validateSkills(skillsDir = getSkillsDir()): Promise<ValidationResult> {
  const skills = await listSkills(skillsDir);
  const errors: string[] = [];

  for (const skill of skills) {
    const text = await readFile(skill.path, "utf8");
    const folder = basename(dirname(skill.path));
    const parsed = parseSkillFrontmatter(text);
    const body = parsed.body ?? "";

    if (!parsed.valid) {
      errors.push(`${skill.path}: invalid frontmatter`);
      continue;
    }
    if (parsed.name !== folder) {
      errors.push(`${skill.path}: name ${JSON.stringify(parsed.name)} does not match folder ${JSON.stringify(folder)}`);
    }
    if (parsed.name.length > 64) {
      errors.push(`${skill.path}: name exceeds 64 characters`);
    }
    if (parsed.description.length > 1024) {
      errors.push(`${skill.path}: description exceeds 1024 characters`);
    }
    if (body.split(/\r?\n/).length > 500) {
      errors.push(`${skill.path}: body exceeds 500 lines`);
    }
    if (body.trim().split(/\s+/).filter(Boolean).length > 500) {
      errors.push(`${skill.path}: body exceeds compact-pack limit of 500 words`);
    }
  }

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
  const currentAgents = await readOptionalText(agentsPath);
  const nextAgents = enabled
    ? upsertManagedBlock(currentAgents, workspaceInstructionBlock())
    : removeManagedBlock(currentAgents);

  await mkdir(stateDir, { recursive: true });
  await writeFile(
    statePath,
    `${JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );

  if (nextAgents.trim().length === 0) {
    await rm(agentsPath, { force: true });
  } else {
    await writeFile(agentsPath, nextAgents, "utf8");
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
  const match = /^---\r?\nname:\s*([a-z0-9-]+)\r?\ndescription:\s*([\s\S]+?)\r?\n---\r?\n/.exec(text);
  if (!match?.[1] || !match[2]) {
    return { description: "", name: "", valid: false };
  }

  return {
    body: text.slice(match[0].length),
    description: match[2].trim(),
    name: match[1].trim(),
    valid: true,
  };
}

function parseRustRuleSummary(text: string): string {
  return /^# [^\r\n]+\r?\n\r?\n>\s+(.+)$/m.exec(text)?.[1]?.trim() ?? "";
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function prepareInstallTarget(target: string, force: boolean): Promise<boolean> {
  try {
    if (force) {
      await rm(target, { recursive: true, force: true });
      return false;
    }
    await readdir(target);
    return true;
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
