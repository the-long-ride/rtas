import { randomBytes } from "node:crypto";
import { cp, mkdir, open, readdir, readFile, rename, rm, stat, writeFile, } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const routerSourceName = "app-engineering-router";
const installedRouterName = "rust-tauri";
const managedBlockStart = "<!-- rust-tauri-agent-skills:start -->";
const managedBlockEnd = "<!-- rust-tauri-agent-skills:end -->";
const txDirName = ".rtas-tx";
const lockName = "lock";
const journalName = "journal.json";
const lockStaleMs = 5 * 60 * 1000;
const skillNamePattern = /^[a-z0-9-]+$/;
const arrowRoutePattern = /→\s*`([a-z0-9-]+)`/g;
const tableRoutePattern = /\|\s*`([a-z0-9-]+)`\s*(?:\||$)/g;
export const AGENT_DIRS = {
    claude: { local: ".claude/skills", global: ".claude/skills" },
    codex: { local: ".codex/agent-skills", global: ".codex/agent-skills" },
    copilot: { local: ".github/agent-skills", global: ".github/agent-skills" },
    gemini: { local: ".gemini/skills", global: ".gemini/skills" },
    github: { local: ".github/agent-skills", global: ".github/agent-skills" },
    opencode: { local: ".opencode/skills", global: ".opencode/skills" },
};
export function resolveAgentDestination(agentOrPath, global = false, workspace = process.cwd()) {
    const agent = agentOrPath.toLowerCase();
    const entry = AGENT_DIRS[agent];
    if (!entry) {
        throw new Error(`Unknown agent: ${agentOrPath}. Supported agents: ${getSupportedAgents().join(", ")}`);
    }
    const relPath = global ? entry.global : entry.local;
    return global ? resolve(homedir(), relPath) : resolve(workspace, relPath);
}
export function getSupportedAgents() {
    return Object.keys(AGENT_DIRS).sort();
}
export function resolveDefaultDestination(global = false, workspace = process.cwd()) {
    const relPath = ".agents/skills/rust-tauri-agent-skills";
    return global ? resolve(homedir(), relPath) : resolve(workspace, relPath);
}
export function suggestAgent(input) {
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
export function getPackageRoot() {
    return projectRoot;
}
export function getSkillsDir() {
    return join(projectRoot, "skills");
}
export function getRustRulesDir() {
    return join(getSkillsDir(), "app-engineering-router", "references", "rust-rules");
}
export async function listRustRules(rulesDir = getRustRulesDir()) {
    const entries = await readdir(rulesDir, { withFileTypes: true });
    const rules = await Promise.all(entries
        .filter((entry) => entry.isFile() && extname(entry.name) === ".md")
        .map(async (entry) => {
        const path = join(rulesDir, entry.name);
        return {
            id: basename(entry.name, ".md"),
            path,
            summary: parseRustRuleSummary(await readFile(path, "utf8")),
        };
    }));
    return rules.sort((left, right) => left.id.localeCompare(right.id));
}
export async function findRustRules(query, rulesDir = getRustRulesDir()) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return listRustRules(rulesDir);
    }
    return (await listRustRules(rulesDir)).filter((rule) => rule.id.includes(normalized) || rule.summary.toLowerCase().includes(normalized));
}
export async function readRustRule(ruleId, rulesDir = getRustRulesDir()) {
    if (!skillNamePattern.test(ruleId)) {
        throw new Error(`Invalid Rust rule ID: ${ruleId}`);
    }
    return readFile(join(rulesDir, `${ruleId}.md`), "utf8");
}
export async function listSkills(skillsDir = getSkillsDir()) {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const summaries = await Promise.all(entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map(async (entry) => readSkillSummary(entry.name, join(skillsDir, entry.name, "SKILL.md"))));
    return summaries.sort((left, right) => left.name.localeCompare(right.name));
}
export async function readSkillSummary(folder, filePath) {
    const text = await readFile(filePath, "utf8");
    const parsed = parseSkillFrontmatter(text);
    return {
        name: parsed.name ?? folder,
        description: parsed.description ?? "",
        path: filePath,
    };
}
export async function installSkills(destination, options = {}, skillsDir = getSkillsDir()) {
    await mkdir(dirname(resolve(destination)), { recursive: true });
    await mkdir(destination, { recursive: true });
    const sourceSkills = await listSkills(skillsDir);
    const plans = [];
    const installed = [];
    const skipped = [];
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
export async function installRouterSkill(destination, options = {}, skillsDir = getSkillsDir()) {
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
        const backup = await commitStaged(txDir, stageDirName, target, exists, journal);
        if (backup) {
            journal.recordBackup(stageDirName, target, backup);
        }
        journal.set({ status: "done" });
    });
    return { installed: [installedRouterName], skipped: [] };
}
export async function validateSkills(input = {}) {
    const opts = typeof input === "string" ? { skillsDir: input } : input;
    const skillsDir = opts.skillsDir ?? getSkillsDir();
    const errors = [];
    const seenNames = new Map();
    const folderEntries = await readdir(skillsDir, { withFileTypes: true });
    const folders = folderEntries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort();
    const skills = [];
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
        }
        else {
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
export async function setRustTauriWorkspaceMode(workspace = process.cwd(), enabled) {
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
        }
        else {
            await atomicWriteText(agentsPath, nextAgents);
        }
        agentsCommitted = true;
        const stateText = `${JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2)}\n`;
        await atomicWriteText(statePath, stateText);
    }
    catch (error) {
        if (agentsCommitted) {
            try {
                if (previousAgents.trim().length === 0) {
                    await rm(agentsPath, { force: true });
                }
                else {
                    await atomicWriteText(agentsPath, previousAgents);
                }
            }
            catch {
                // Best-effort rollback; surface original error to the caller.
            }
        }
        throw error;
    }
    return { agentsPath, enabled, statePath, workspace: target };
}
export async function getRustTauriWorkspaceMode(workspace = process.cwd()) {
    const target = resolve(workspace);
    const statePath = join(target, ".rust-tauri-agent-skills", "state.json");
    const agentsPath = join(target, "AGENTS.md");
    const stateText = await readOptionalText(statePath);
    const agentsText = await readOptionalText(agentsPath);
    let enabled = agentsText.includes(managedBlockStart) && agentsText.includes(managedBlockEnd);
    if (stateText.trim().length > 0) {
        try {
            const parsed = JSON.parse(stateText);
            enabled = parsed.enabled === true && enabled;
        }
        catch {
            enabled = false;
        }
    }
    return { agentsPath, enabled, statePath, workspace: target };
}
function parseSkillFrontmatter(text) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!match) {
        return { description: "", name: "", valid: false };
    }
    const frontmatterText = match[1] ?? "";
    let parsed;
    try {
        parsed = YAML.parse(frontmatterText);
    }
    catch {
        return { description: "", name: "", valid: false };
    }
    if (!parsed || typeof parsed !== "object") {
        return { description: "", name: "", valid: false };
    }
    const record = parsed;
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
function replaceFrontmatterName(text, newName) {
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
function parseRustRuleSummary(text) {
    return /^# [^\r\n]+\r?\n\r?\n>\s+(.+)$/m.exec(text)?.[1]?.trim() ?? "";
}
async function stageAll(txDir, plans) {
    const stageDir = join(txDir, "stage");
    await mkdir(stageDir, { recursive: true });
    for (const plan of plans) {
        await cp(plan.source, join(stageDir, plan.name), { recursive: true, force: true });
    }
}
async function stageRouter(txDir, stageDirName, routerSource, installedRouterText) {
    const stagedDir = join(txDir, "stage", stageDirName);
    await copyRouterTree(routerSource, stagedDir, installedRouterText);
}
async function commitAll(txDir, plans, journal) {
    const committed = [];
    try {
        for (const plan of plans) {
            const backup = await commitStagedByName(txDir, plan.name, plan.target, plan.force, journal);
            committed.push({ name: plan.name, target: plan.target, backup: backup ?? "" });
            journal.recordBackup(plan.name, plan.target, backup);
        }
    }
    catch (error) {
        journal.set({ status: "rolling-back" });
        await rollbackCommits(committed, journal);
        journal.set({ status: "failed" });
        throw error;
    }
}
async function commitStagedByName(txDir, stageName, target, targetExists, _journal) {
    const staged = join(txDir, "stage", stageName);
    const backup = targetExists ? await moveExistingToBackup(txDir, stageName, target) : undefined;
    await rename(staged, target);
    return backup;
}
async function commitStaged(txDir, stageName, target, targetExists, _journal) {
    return commitStagedByName(txDir, stageName, target, targetExists, _journal);
}
async function moveExistingToBackup(txDir, stageName, target) {
    const backupDir = join(txDir, "backups", `${stageName}-${newTxId()}`);
    await mkdir(dirname(backupDir), { recursive: true });
    await rename(target, backupDir);
    return backupDir;
}
async function rollbackCommits(committed, journal) {
    for (const entry of [...committed].reverse()) {
        try {
            if (entry.backup && (await pathExists(entry.backup))) {
                if (await pathExists(entry.target)) {
                    await rm(entry.target, { recursive: true, force: true });
                }
                await rename(entry.backup, entry.target);
            }
            else if (await pathExists(entry.target)) {
                await rm(entry.target, { recursive: true, force: true });
            }
        }
        catch (error) {
            journal.appendError(`rollback failed for ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
class TxJournalWriter {
    path;
    entries;
    errors = [];
    constructor(txDir, txId) {
        this.path = join(txDir, journalName);
        this.entries = { txId, status: "staging", createdAt: new Date().toISOString(), commits: [] };
        void this.persist();
    }
    set(patch) {
        Object.assign(this.entries, patch);
        void this.persist();
    }
    recordBackup(name, target, backup) {
        this.entries.commits.push({ name, target, backup: backup ?? "" });
        void this.persist();
    }
    appendError(message) {
        this.errors.push(message);
        void this.persist();
    }
    getErrors() {
        return this.errors;
    }
    async persist() {
        try {
            await writeFile(this.path, `${JSON.stringify({ ...this.entries, errors: this.errors }, null, 2)}\n`, "utf8");
        }
        catch {
            // Persistence best-effort; in-memory state still drives rollback.
        }
    }
}
async function withInstallTx(destination, body) {
    const txRoot = join(destination, txDirName);
    await mkdir(txRoot, { recursive: true });
    const txId = newTxId();
    const txDir = join(txRoot, txId);
    await mkdir(txDir, { recursive: true });
    const journal = new TxJournalWriter(txDir, txId);
    const release = await acquireLock(txRoot);
    let succeeded = false;
    try {
        await body(txDir, journal);
        succeeded = true;
    }
    catch (error) {
        try {
            const j = await readJournal(txDir);
            if (j && j.status !== "done" && j.commits.length > 0) {
                await rollbackCommits(j.commits, journal);
            }
        }
        catch {
            // Original error wins.
        }
        try {
            if (await pathExists(txDir)) {
                await rename(txDir, `${txDir}.failed-${Date.now()}`);
            }
        }
        catch {
            // Best-effort: leave the failed tx dir in place for later recovery.
        }
        throw error;
    }
    finally {
        try {
            if (succeeded) {
                await rm(txDir, { recursive: true, force: true });
            }
        }
        catch {
            // Best-effort cleanup.
        }
        await release();
        if (succeeded) {
            try {
                await rm(txRoot, { recursive: true, force: true });
            }
            catch {
                // Other concurrent installs may still be using the tx root.
            }
        }
    }
}
async function acquireLock(txRoot) {
    const lockPath = join(txRoot, lockName);
    const maxAttempts = 30;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const handle = await open(lockPath, "wx");
            await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
            await handle.close();
            return async () => {
                try {
                    await rm(lockPath, { force: true });
                }
                catch {
                    // Best-effort.
                }
            };
        }
        catch (error) {
            if (!isExistsError(error)) {
                throw error;
            }
            if (await stealStaleLock(txRoot, lockPath)) {
                continue;
            }
            await sleep(200);
        }
    }
    throw new Error(`Could not acquire install lock after ${maxAttempts} attempts: ${lockPath}. Another rtas install may be running; remove the lock manually if it is stale.`);
}
async function stealStaleLock(txRoot, lockPath) {
    let startedAt;
    try {
        const text = await readFile(lockPath, "utf8");
        const parsed = JSON.parse(text);
        if (parsed.startedAt) {
            const ts = Date.parse(parsed.startedAt);
            if (!Number.isNaN(ts)) {
                startedAt = ts;
            }
        }
    }
    catch {
        // Not a valid lock file — fall through to mtime check.
    }
    const threshold = startedAt ?? (await stat(lockPath)).mtimeMs;
    if (Date.now() - threshold < lockStaleMs) {
        return false;
    }
    try {
        await rm(lockPath, { force: true });
        return true;
    }
    catch {
        return false;
    }
}
async function readJournal(txDir) {
    const path = join(txDir, journalName);
    try {
        const text = await readFile(path, "utf8");
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
export async function recoverInterruptedInstalls(parentDir) {
    const txRoot = join(parentDir, txDirName);
    if (!(await pathExists(txRoot))) {
        return [];
    }
    const release = await acquireLock(txRoot);
    try {
        const entries = await readdir(txRoot, { withFileTypes: true });
        const recovered = [];
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name === "stage" || entry.name === lockName) {
                continue;
            }
            if (entry.name.endsWith(".failed-")) {
                recovered.push(await cleanupFailedTx(join(txRoot, entry.name)));
                continue;
            }
            const txDir = join(txRoot, entry.name);
            const journal = await readJournal(txDir);
            if (!journal) {
                await rm(txDir, { recursive: true, force: true });
                recovered.push(`removed orphan tx ${entry.name}`);
                continue;
            }
            if (journal.status === "done") {
                await rm(txDir, { recursive: true, force: true });
                recovered.push(`removed completed tx ${entry.name}`);
                continue;
            }
            if (journal.commits.length > 0) {
                await rollbackCommits(journal.commits, new SilentJournal());
                recovered.push(`rolled back tx ${entry.name} with ${journal.commits.length} commits`);
            }
            else {
                recovered.push(`cleaned staging-only tx ${entry.name}`);
            }
            await rm(txDir, { recursive: true, force: true });
        }
        try {
            await rm(txRoot, { recursive: true, force: true });
        }
        catch {
            // Best-effort: leave txRoot if non-empty (e.g., new concurrent installs).
        }
        return recovered;
    }
    finally {
        await release();
    }
}
async function cleanupFailedTx(txDir) {
    const journal = await readJournal(txDir);
    if (journal && journal.commits.length > 0) {
        await rollbackCommits(journal.commits, new SilentJournal());
    }
    await rm(txDir, { recursive: true, force: true });
    return `rolled back failed tx ${basename(txDir)}`;
}
class SilentJournal {
    appendError() { }
}
async function copyRouterTree(routerSource, stagedDir, installedRouterText) {
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
async function atomicWriteText(path, text) {
    const staged = `${path}.rtas-stage.${process.pid}`;
    await mkdir(dirname(path), { recursive: true });
    try {
        await writeFile(staged, text, "utf8");
        await rename(staged, path);
    }
    catch (error) {
        await rm(staged, { force: true });
        throw error;
    }
}
async function validateRouterTargets(skillsDir, skills) {
    const errors = [];
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
async function validateRoutingTable(routingPath, skills) {
    const errors = [];
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
function collectRouteTargets(text) {
    const ids = new Set();
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
async function siblingRoutingFile(skillsDir) {
    const candidate = join(dirname(skillsDir), "ROUTING.md");
    if (await pathExists(candidate)) {
        return candidate;
    }
    return undefined;
}
function newTxId() {
    return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}
function sleep(ms) {
    return new Promise((resolveTimer) => setTimeout(resolveTimer, ms));
}
function levenshtein(left, right) {
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
function isNotFoundError(error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
function isExistsError(error) {
    return Boolean(error && typeof error === "object" && "code" in error && (error.code === "EEXIST" || error.code === "EISDIR"));
}
async function pathExists(path) {
    try {
        await stat(path);
        return true;
    }
    catch (error) {
        if (!isNotFoundError(error)) {
            throw error;
        }
        return false;
    }
}
async function readOptionalText(path) {
    try {
        return await readFile(path, "utf8");
    }
    catch (error) {
        if (isNotFoundError(error)) {
            return "";
        }
        throw error;
    }
}
function upsertManagedBlock(text, block) {
    const stripped = removeManagedBlock(text).trimEnd();
    return `${stripped}${stripped ? "\n\n" : ""}${block}\n`;
}
function removeManagedBlock(text) {
    const pattern = new RegExp(`${escapeRegExp(managedBlockStart)}[\\s\\S]*?${escapeRegExp(managedBlockEnd)}\\n?`, "g");
    return text.replace(pattern, "").trimEnd() + (text.trim().length > 0 ? "\n" : "");
}
function workspaceInstructionBlock() {
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
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
