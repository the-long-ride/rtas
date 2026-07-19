import { randomBytes } from "node:crypto";
import {
  cp,
  mkdir,
  open,
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

export interface ValidateOptions {
  skillsDir?: string;
  routingFile?: string;
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const routerSourceName = "app-engineering-router";
const installedRouterName = "rust-tauri";
const managedBlockStart = "<!-- rust-tauri-agent-skills:start -->";
const managedBlockEnd = "<!-- rust-tauri-agent-skills:end -->";
const txDirName = ".rtas-tx";
const lockName = "lock";
const journalName = "journal.json";
const lockStaleMs = 5 * 60 * 1000;
const heartbeatIntervalMs = 15 * 1000;
const skillNamePattern = /^[a-z0-9-]+$/;
const arrowRoutePattern = /→\s*`([a-z0-9-]+)`/g;
const tableRoutePattern = /\|\s*`([a-z0-9-]+)`\s*(?:\||$)/g;

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
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
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
  await mkdir(dirname(resolve(destination)), { recursive: true });
  await mkdir(destination, { recursive: true });

  const sourceSkills = await listSkills(skillsDir);
  const plans: Array<{ name: string; source: string; target: string; force: boolean }> = [];
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const skill of sourceSkills) {
    const skillFolder = basename(dirname(skill.path));
    const target = join(destination, skillFolder);
    const source = join(skillsDir, skillFolder);
    const exists = await pathExists(target);
    if (exists && options.force !== true) {
      skipped.push(skillFolder);
      continue;
    }
    plans.push({ name: skillFolder, source, target, force: exists });
  }
  if (plans.length === 0) {
    return { installed, skipped };
  }

  await withInstallTx(destination, async (txDir, journal) => {
    await stageAll(txDir, plans);
    journal.set({ status: "committing" });
    await commitAll(txDir, plans, journal);
    journal.set({ status: "done" });
  });

  for (const plan of plans) {
    installed.push(plan.name);
  }

  return { installed, skipped };
}

export async function installRouterSkill(
  destination: string,
  options: InstallOptions = {},
  skillsDir = getSkillsDir(),
): Promise<InstallResult> {
  await mkdir(dirname(resolve(destination)), { recursive: true });
  await mkdir(destination, { recursive: true });

  const target = join(destination, installedRouterName);
  const exists = await pathExists(target);
  if (exists && options.force !== true) {
    return { installed: [], skipped: [installedRouterName] };
  }

  const routerSource = join(skillsDir, routerSourceName);
  const routerText = await readFile(join(routerSource, "SKILL.md"), "utf8");
  const installedRouterText = replaceFrontmatterName(routerText, installedRouterName);
  const stageDirName = installedRouterName;

  await withInstallTx(destination, async (txDir, journal) => {
    await stageRouter(txDir, stageDirName, routerSource, installedRouterText);
    journal.set({ status: "committing" });
    const committer = new TxCommitter(txDir, journal);
    await committer.commit({
      name: stageDirName,
      source: join(txDir, "stage", stageDirName),
      target,
      force: exists,
    });
    journal.set({ status: "done" });
  });

  return { installed: [installedRouterName], skipped: [] };
}

export async function validateSkills(input: string | ValidateOptions = {}): Promise<ValidationResult> {
  const opts: ValidateOptions = typeof input === "string" ? { skillsDir: input } : input;
  const skillsDir = opts.skillsDir ?? getSkillsDir();
  const errors: string[] = [];
  const seenNames = new Map<string, string>();
  const folderEntries = await readdir(skillsDir, { withFileTypes: true });
  const folders = folderEntries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
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

  const routingPath = opts.routingFile ?? await siblingRoutingFile(skillsDir);
  if (routingPath) {
    errors.push(...(await validateRoutingTable(routingPath, skills)));
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

type CommitState = "prepared" | "backup-created" | "replaced" | "complete" | "restored";

interface TxCommit {
  name: string;
  target: string;
  backup?: string;
  state: CommitState;
}

interface TxJournal {
  txId: string;
  status: string;
  createdAt: string;
  heartbeatAt: string;
  pid: number;
  commits: TxCommit[];
  errors: string[];
}

interface TxJournalAppender {
  appendError(message: string): void;
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

function replaceFrontmatterName(text: string, newName: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n?)/.exec(text);
  if (!match) {
    throw new Error("Cannot replace frontmatter name: frontmatter block not found");
  }

  const frontmatterText = match[1] ?? "";
  const tail = text.slice(match[0].length);
  const doc = YAML.parseDocument(frontmatterText);
  if (doc.errors.length > 0) {
    throw new Error(`Cannot parse router frontmatter as YAML: ${doc.errors[0]}`);
  }
  doc.set("name", newName);
  const serialized = doc
    .toString({ lineWidth: 0, indent: 2, defaultStringType: "QUOTE_DOUBLE" })
    .trimEnd();
  return `---\n${serialized}\n---\n${tail.startsWith("\n") ? tail.slice(1) : tail}`;
}

function parseRustRuleSummary(text: string): string {
  return /^# [^\r\n]+\r?\n\r?\n>\s+(.+)$/m.exec(text)?.[1]?.trim() ?? "";
}

interface StagePlan {
  name: string;
  source: string;
  target: string;
  force: boolean;
}

async function stageAll(txDir: string, plans: StagePlan[]): Promise<void> {
  const stageDir = join(txDir, "stage");
  await mkdir(stageDir, { recursive: true });
  for (const plan of plans) {
    await cp(plan.source, join(stageDir, plan.name), { recursive: true, force: true });
  }
}

async function stageRouter(
  txDir: string,
  stageDirName: string,
  routerSource: string,
  installedRouterText: string,
): Promise<void> {
  const stagedDir = join(txDir, "stage", stageDirName);
  await copyRouterTree(routerSource, stagedDir, installedRouterText);
}

async function commitAll(
  txDir: string,
  plans: StagePlan[],
  journal: TxJournalWriter,
): Promise<void> {
  const committer = new TxCommitter(txDir, journal);
  try {
    for (const plan of plans) {
      await committer.commit(plan);
    }
  } catch (error) {
    await committer.rollbackAll();
    throw error;
  }
}

class TxCommitter {
  private readonly txDir: string;
  private readonly journal: TxJournalRecorder;
  private readonly commits: TxCommit[] = [];

  constructor(txDir: string, journal: TxJournalRecorder) {
    this.txDir = txDir;
    this.journal = journal;
  }

  async commit(plan: StagePlan): Promise<void> {
    const staged = join(this.txDir, "stage", plan.name);
    const stagedExists = await pathExists(staged);
    if (!stagedExists) {
      throw new Error(`staged skill missing: ${staged}`);
    }
    const targetExists = await pathExists(plan.target);
    if (targetExists && !plan.force) {
      throw new Error(`Destination already exists: ${plan.target}`);
    }
    const commit: TxCommit = { name: plan.name, target: plan.target, state: "prepared" };
    this.commits.push(commit);
    await this.journal.recordCommit(commit);

    if (targetExists) {
      const backup = join(this.txDir, "backups", `${plan.name}-${newTxId()}`);
      await mkdir(dirname(backup), { recursive: true });
      commit.state = "backup-created";
      commit.backup = backup;
      await this.journal.recordCommit(commit);
      await rename(plan.target, backup);
    }

    commit.state = "replaced";
    await this.journal.recordCommit(commit);
    await rename(staged, plan.target);

    commit.state = "complete";
    await this.journal.recordCommit(commit);
  }

  async rollbackAll(): Promise<void> {
    for (const commit of [...this.commits].reverse()) {
      try {
        await this.rollbackOne(commit);
      } catch (error) {
        this.journal.appendError(
          `rollback failed for ${commit.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async rollbackOne(commit: TxCommit): Promise<void> {
    if (commit.state === "restored" || commit.state === "prepared") {
      return;
    }
    const backup = commit.backup;
    const backupExists = backup ? await pathExists(backup) : false;
    if (!backupExists) {
      // No backup to restore from; never delete the current target. Idempotency
      // guard: a previous rollback may have already restored it.
      commit.state = "restored";
      await this.journal.recordCommit(commit);
      return;
    }
    if (backup && backupExists) {
      const targetExists = await pathExists(commit.target);
      if (targetExists) {
        await rm(commit.target, { recursive: true, force: true });
      }
      await rename(backup, commit.target);
      commit.state = "restored";
      await this.journal.recordCommit(commit);
    }
  }
}

class TxJournalWriter implements TxJournalAppender {
  private readonly path: string;
  private readonly entries: TxJournal;
  private errors: string[] = [];
  private writeChain: Promise<void> = Promise.resolve();

  constructor(txDir: string, txId: string) {
    this.path = join(txDir, journalName);
    this.entries = {
      txId,
      status: "staging",
      createdAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      pid: process.pid,
      commits: [],
      errors: [],
    };
    void this.persistSync();
  }

  set(patch: Partial<TxJournal>): Promise<void> {
    Object.assign(this.entries, patch);
    return this.persistSync();
  }

  recordCommit(commit: TxCommit): Promise<void> {
    const existing = this.entries.commits.find((c) => c.name === commit.name);
    if (existing) {
      Object.assign(existing, commit);
    } else {
      this.entries.commits.push({ ...commit });
    }
    return this.persistSync();
  }

  appendError(message: string): void {
    this.errors.push(message);
    this.entries.errors = [...this.errors];
    void this.persistSync();
  }

  heartbeat(): Promise<void> {
    this.entries.heartbeatAt = new Date().toISOString();
    return this.persistSync();
  }

  getErrors(): string[] {
    return this.errors;
  }

  private persistSync(): Promise<void> {
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => this.atomicWrite());
    return this.writeChain;
  }

  private async atomicWrite(): Promise<void> {
    // Plain writeFile keeps the journal durable-enough for crash recovery.
    // Renaming over an existing file is unreliable on Windows (EPERM if an
    // AV scanner or other reader holds it open) and readJournal already
    // tolerates a partial/corrupt JSON via JSON.parse failure.
    const payload = `${JSON.stringify({ ...this.entries, errors: this.errors }, null, 2)}\n`;
    await writeFile(this.path, payload, "utf8");
  }
}

async function withInstallTx(
  destination: string,
  body: (txDir: string, journal: TxJournalWriter) => Promise<void>,
): Promise<void> {
  const txRoot = join(destination, txDirName);
  await mkdir(txRoot, { recursive: true });
  const release = await acquireLock(txRoot);
  let txDir: string | undefined;
  let journal: TxJournalWriter | undefined;
  let succeeded = false;
  const heartbeat = startHeartbeat(() => journal?.heartbeat());
  try {
    const txId = newTxId();
    txDir = join(txRoot, txId);
    await mkdir(txDir, { recursive: true });
    journal = new TxJournalWriter(txDir, txId);
    await body(txDir, journal);
    succeeded = true;
  } catch (error) {
    try {
      if (txDir && journal) {
        const j = await readJournal(txDir);
        if (j && j.status !== "done" && j.commits.some((c) => c.state !== "restored" && c.state !== "prepared")) {
          // Recovery path: re-run rollback using the persisted journal state, which is idempotent.
          await rerunRollback(txDir, j, journal);
        }
      }
    } catch {
      // Original error wins.
    }
    if (txDir && (await pathExists(txDir))) {
      try {
        await rename(txDir, `${txDir}.failed-${Date.now()}`);
      } catch {
        // Best-effort: leave failed tx dir for `rtas recover`.
      }
    }
    throw error;
  }   finally {
    heartbeat.stop();
    if (succeeded && txDir) {
      try {
        await rmWithRetry(txDir);
      } catch {
        // Best-effort cleanup; leftover dir is recoverable via `rtas recover`.
      }
    }
    await release();
    if (succeeded) {
      // txRoot is private to this lock owner; safe to remove recursively.
      try {
        await rmWithRetry(txRoot);
      } catch {
        // Best-effort: leave txRoot for `rtas recover` if removal keeps failing.
      }
    }
  }
}

async function rmWithRetry(target: string): Promise<void> {
  const maxAttempts = 10;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!isExistsError(error) && !isEpermError(error)) throw error;
      await sleep(50 * Math.pow(2, attempt));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`rmWithRetry failed: ${target}`);
}

function isEpermError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && (error as NodeJS.ErrnoException).code === "EPERM";
}

function startHeartbeat(beat: () => Promise<void> | undefined): { stop: () => void } {
  const handle = setInterval(() => {
    const result = beat();
    if (result) void result.catch(() => undefined);
  }, heartbeatIntervalMs);
  return { stop: () => clearInterval(handle) };
}

async function acquireLock(txRoot: string): Promise<() => Promise<void>> {
  const lockPath = join(txRoot, lockName);
  const maxAttempts = 30;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
        "utf8",
      );
      await handle.close();
      return async () => {
        try {
          await rm(lockPath, { force: true });
        } catch {
          // Best-effort.
        }
      };
    } catch (error) {
      if (!isExistsError(error)) {
        throw error;
      }
      if (await canStealLock(lockPath)) {
        continue;
      }
      await sleep(200);
    }
  }
  throw new Error(
    `Could not acquire install lock after ${maxAttempts} attempts: ${lockPath}. Another rtas install may be running; run 'rtas recover' to clean up an abandoned lock.`,
  );
}

async function canStealLock(lockPath: string): Promise<boolean> {
  let lockData: { pid?: number; startedAt?: string } = {};
  try {
    const text = await readFile(lockPath, "utf8");
    lockData = JSON.parse(text) as { pid?: number; startedAt?: string };
  } catch {
    // Corrupt or unreadable: treat as steal-able if file is old.
  }
  const startedAt = lockData.startedAt ? Date.parse(lockData.startedAt) : NaN;
  const threshold = Number.isNaN(startedAt) ? (await stat(lockPath).catch(() => ({ mtimeMs: 0 }))).mtimeMs : startedAt;
  const lockPid = typeof lockData.pid === "number" ? lockData.pid : undefined;

  if (Date.now() - threshold < lockStaleMs) {
    return false;
  }
  if (lockPid !== undefined && isProcessAlive(lockPid)) {
    // Owner is still running. Do not steal even if heartbeat is old (slow fs, paused).
    return false;
  }
  try {
    await rm(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return false;
  }
}

async function readJournal(txDir: string): Promise<TxJournal | undefined> {
  const path = join(txDir, journalName);
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as TxJournal;
  } catch {
    return undefined;
  }
}

interface TxJournalRecorder {
  recordCommit(commit: TxCommit): Promise<void>;
  appendError(message: string): void;
}

async function rerunRollback(txDir: string, j: TxJournal, journal: TxJournalRecorder): Promise<void> {
  const committer = new TxCommitter(txDir, journal);
  for (const commit of [...j.commits].reverse()) {
    if (commit.state === "restored" || commit.state === "prepared") continue;
    try {
      // reach into private via duplicate logic
      const backup = commit.backup;
      const backupExists = backup ? await pathExists(backup) : false;
      if (!backupExists) {
        commit.state = "restored";
        await journal.recordCommit(commit);
        continue;
      }
      if (backup && backupExists) {
        const targetExists = await pathExists(commit.target);
        if (targetExists) {
          await rm(commit.target, { recursive: true, force: true });
        }
        await rename(backup, commit.target);
        commit.state = "restored";
        await journal.recordCommit(commit);
      }
    } catch (error) {
      journal.appendError(`recovery rollback failed for ${commit.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export async function recoverInterruptedInstalls(parentDir: string): Promise<string[]> {
  const txRoot = join(parentDir, txDirName);
  if (!(await pathExists(txRoot))) {
    return [];
  }
  const release = await acquireLock(txRoot);
  try {
    const entries = await readdir(txRoot, { withFileTypes: true });
    const recovered: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "stage" || entry.name === lockName) {
        continue;
      }
      const txDir = join(txRoot, entry.name);
      const journal = await readJournal(txDir);
      const backupsDir = join(txDir, "backups");
      const backupsPresent = (await pathExists(backupsDir)) && (await readdir(backupsDir).catch(() => [])).length > 0;

      if (!journal) {
        if (backupsPresent) {
          recovered.push(
            `preserved tx ${entry.name}: journal missing but backups exist. Inspect ${txDir} manually and move backups/<name>-* to the intended target if needed.`,
          );
        } else {
          await rm(txDir, { recursive: true, force: true });
          recovered.push(`removed orphan tx ${entry.name} (no journal, no backups)`);
        }
        continue;
      }

      if (entry.name.includes(".failed-")) {
        recovered.push(await cleanupFailedTx(txDir, journal));
        continue;
      }

      if (journal.status === "done") {
        await rm(txDir, { recursive: true, force: true });
        recovered.push(`removed completed tx ${entry.name}`);
        continue;
      }

      const live = journal.pid !== undefined && isProcessAlive(journal.pid);
      if (live && journal.commits.length === 0) {
        recovered.push(`skipped tx ${entry.name}: owner pid ${journal.pid} still alive and staging`);
        continue;
      }
      if (journal.commits.some((c) => c.state !== "restored" && c.state !== "prepared")) {
        const writer = new SilentJournalWriter();
        await rerunRollback(txDir, journal, writer);
        recovered.push(`rolled back tx ${entry.name} with ${journal.commits.length} commits`);
      } else {
        recovered.push(`cleaned staging-only tx ${entry.name}`);
      }
      await rm(txDir, { recursive: true, force: true });
    }
    try {
      await rmWithRetry(txRoot);
    } catch {
      // Best-effort: leave txRoot if non-empty (e.g., concurrent installs).
    }
    return recovered;
  } finally {
    await release();
  }
}

async function cleanupFailedTx(txDir: string, journal: TxJournal | undefined): Promise<string> {
  if (journal && journal.commits.some((c) => c.state !== "restored" && c.state !== "prepared")) {
    const writer = new SilentJournalWriter();
    await rerunRollback(txDir, journal, writer);
  }
  await rm(txDir, { recursive: true, force: true });
  return `rolled back failed tx ${basename(txDir)}`;
}

class SilentJournalWriter implements TxJournalRecorder {
  appendError(): void { /* no-op */ }
  recordCommit(): Promise<void> { return Promise.resolve(); }
}

async function rmEmptyDir(path: string): Promise<void> {
  try {
    const stats = await stat(path);
    if (!stats.isDirectory()) return;
    const entries = await readdir(path);
    if (entries.length === 0) {
      await rm(path, { recursive: false, force: true });
    }
  } catch {
    // best-effort
  }
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
  const referenced = collectRouteTargets(routerText);
  const known = new Set(skills.map((skill) => skill.name));
  for (const id of referenced) {
    if (!known.has(id)) {
      errors.push(`${routerPath}: route target ${JSON.stringify(id)} does not match any skill folder`);
    }
  }

  return errors;
}

async function validateRoutingTable(
  routingPath: string,
  skills: SkillSummary[],
): Promise<string[]> {
  const errors: string[] = [];
  if (!(await pathExists(routingPath))) {
    return errors;
  }

  const routingText = await readFile(routingPath, "utf8");
  const referenced = collectRouteTargets(routingText);
  const known = new Set(skills.map((skill) => skill.name));
  for (const id of referenced) {
    if (!known.has(id)) {
      errors.push(`${routingPath}: routing target ${JSON.stringify(id)} does not match any skill folder`);
    }
  }

  return errors;
}

function collectRouteTargets(text: string): Set<string> {
  const ids = new Set<string>();
  for (const pattern of [arrowRoutePattern, tableRoutePattern]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const id = match[1];
      if (id) {
        ids.add(id);
      }
    }
  }
  return ids;
}

async function siblingRoutingFile(skillsDir: string): Promise<string | undefined> {
  const candidate = join(dirname(skillsDir), "ROUTING.md");
  if (await pathExists(candidate)) {
    return candidate;
  }
  return undefined;
}

function newTxId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveTimer) => setTimeout(resolveTimer, ms));
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

function isExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error.code === "EEXIST" || error.code === "EISDIR"));
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
