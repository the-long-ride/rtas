import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
import {
  findRustRules,
  getRustTauriWorkspaceMode,
  getSupportedAgents,
  installSkills,
  listRustRules,
  readRustRule,
  listSkills,
  resolveAgentDestination,
  resolveDefaultDestination,
  setRustTauriWorkspaceMode,
  validateSkills,
} from "../dist/index.js";

test("skills validate through TypeScript package API", async () => {
  const result = await validateSkills();
  assert.equal(result.count, 18);
  assert.deepEqual(result.errors, []);
});

test("package root exposes compiled API", async () => {
  const packageApi = await import("@the-long-ride/rust-tauri-agent-skills");
  assert.equal(typeof packageApi.installSkills, "function");
  assert.equal(typeof packageApi.installRouterSkill, "function");
  assert.equal(typeof packageApi.validateSkills, "function");
});

test("package.json exposes rtas CLI bin alias", async () => {
  const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
  assert.equal(pkg.bin.rtas, "./dist/cli.js");
  assert.equal(pkg.bin["rust-tauri-agent-skills"], "./dist/cli.js");
  assert.equal(pkg.bin["rust-tauri"], "./dist/cli.js");
  assert.equal(pkg.bin["rtas-skills"], "./dist/cli.js");
});

test("full vendored Rust rule corpus is searchable and readable", async () => {
  const rules = await listRustRules();
  assert.equal(rules.length, 265);
  assert.equal(rules.find((rule) => rule.id === "async-no-lock-await")?.summary, "Never hold `Mutex`/`RwLock` across `.await`");

  const matches = await findRustRules("cancellation");
  assert.ok(matches.some((rule) => rule.id === "async-cancellation-token"));

  const source = await readRustRule("unsafe-safety-comment");
  assert.match(source, /# Safety/);
});

test("installer copies skills and skips existing skills unless forced", async () => {
  const destination = await mkdtemp(join(tmpdir(), "rtas-skills-"));
  try {
    const first = await installSkills(destination);
    assert.equal(first.installed.length, 18);
    assert.deepEqual(first.skipped, []);

    const second = await installSkills(destination);
    assert.deepEqual(second.installed, []);
    assert.equal(second.skipped.length, 18);

    const forced = await installSkills(destination, { force: true });
    assert.equal(forced.installed.length, 18);
    assert.deepEqual(forced.skipped, []);

    const router = await readFile(join(destination, "app-engineering-router", "SKILL.md"), "utf8");
    assert.match(router, /^---\nname:\s*app-engineering-router/m);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

test("getSupportedAgents returns known agents", () => {
  assert.deepEqual(getSupportedAgents().sort(), [
    "claude",
    "codex",
    "copilot",
    "gemini",
    "github",
    "opencode",
  ]);
});

test("resolveAgentDestination maps agents to workspace-local paths", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-resolve-local-"));
  try {
    assert.equal(resolveAgentDestination("claude", false, workspace), join(workspace, ".claude", "skills"));
    assert.equal(resolveAgentDestination("codex", false, workspace), join(workspace, ".codex", "agent-skills"));
    assert.equal(resolveAgentDestination("copilot", false, workspace), join(workspace, ".github", "agent-skills"));
    assert.equal(resolveAgentDestination("github", false, workspace), join(workspace, ".github", "agent-skills"));
    assert.equal(resolveAgentDestination("gemini", false, workspace), join(workspace, ".gemini", "skills"));
    assert.equal(resolveAgentDestination("opencode", false, workspace), join(workspace, ".opencode", "skills"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("resolveAgentDestination maps agents to global paths", () => {
  assert.equal(resolveAgentDestination("claude", true), resolve(homedir(), ".claude", "skills"));
  assert.equal(resolveAgentDestination("codex", true), resolve(homedir(), ".codex", "agent-skills"));
  assert.equal(resolveAgentDestination("copilot", true), resolve(homedir(), ".github", "agent-skills"));
  assert.equal(resolveAgentDestination("gemini", true), resolve(homedir(), ".gemini", "skills"));
  assert.equal(resolveAgentDestination("github", true), resolve(homedir(), ".github", "agent-skills"));
  assert.equal(resolveAgentDestination("opencode", true), resolve(homedir(), ".opencode", "skills"));
});

test("resolveAgentDestination is case-insensitive", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-resolve-case-"));
  try {
    assert.equal(resolveAgentDestination("Claude", false, workspace), join(workspace, ".claude", "skills"));
    assert.equal(resolveAgentDestination("CLAUDE", true), resolve(homedir(), ".claude", "skills"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("resolveAgentDestination throws for unknown agent", () => {
  assert.throws(() => resolveAgentDestination("unknown"), /Unknown agent/);
});

test("CLI install claude exposes one router skill with nested specialists", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-cli-local-"));
  try {
    const result = await execFileAsync(process.execPath, [cliPath, "install", "claude"], {
      cwd: workspace,
    });
    assert.match(result.stdout, /Installed rust-tauri/);

    const skillRoot = join(workspace, ".claude", "skills");
    assert.deepEqual(await readdir(skillRoot), ["rust-tauri"]);
    const router = await readFile(join(skillRoot, "rust-tauri", "SKILL.md"), "utf8");
    assert.match(router, /^---\nname:\s*rust-tauri/m);
    await readFile(join(skillRoot, "rust-tauri", "skills", "typescript-strict", "SKILL.md"), "utf8");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("CLI install claude --global copies skills to user home", async () => {
  const home = await mkdtemp(join(tmpdir(), "rtas-cli-global-home-"));
  try {
    const result = await execFileAsync(process.execPath, [cliPath, "install", "claude", "--global"], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.match(result.stdout, /Installed rust-tauri/);

    const skillRoot = join(home, ".claude", "skills");
    assert.deepEqual(await readdir(skillRoot), ["rust-tauri"]);
    const router = await readFile(join(skillRoot, "rust-tauri", "SKILL.md"), "utf8");
    assert.match(router, /^---\nname:\s*rust-tauri/m);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("CLI install claude --force replaces existing skills", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-cli-force-"));
  try {
    await execFileAsync(process.execPath, [cliPath, "install", "claude"], { cwd: workspace });
    const first = await readFile(
      join(workspace, ".claude", "skills", "rust-tauri", "skills", "typescript-strict", "SKILL.md"),
      "utf8",
    );

    const result = await execFileAsync(process.execPath, [cliPath, "install", "claude", "--force"], {
      cwd: workspace,
    });
    assert.match(result.stdout, /Installed rust-tauri/);

    const second = await readFile(
      join(workspace, ".claude", "skills", "rust-tauri", "skills", "typescript-strict", "SKILL.md"),
      "utf8",
    );
    assert.equal(first, second);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("CLI install skips one router package and --all exposes every skill", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-cli-router-skip-"));
  try {
    await execFileAsync(process.execPath, [cliPath, "install", "claude"], { cwd: workspace });
    const skipped = await execFileAsync(process.execPath, [cliPath, "install", "claude"], { cwd: workspace });
    assert.match(skipped.stderr, /Skipping existing router: rust-tauri/);

    const allWorkspace = await mkdtemp(join(tmpdir(), "rtas-cli-all-"));
    try {
      const result = await execFileAsync(process.execPath, [cliPath, "install", "claude", "--all"], {
        cwd: allWorkspace,
      });
      assert.match(result.stdout, /Installed app-engineering-router/);
      assert.equal((await readdir(join(allWorkspace, ".claude", "skills"))).length, 18);
      await readFile(join(allWorkspace, ".claude", "skills", "app-engineering-router", "SKILL.md"), "utf8");
    } finally {
      await rm(allWorkspace, { recursive: true, force: true });
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("CLI install --all --global with agent writes every skill to user home", async () => {
  const home = await mkdtemp(join(tmpdir(), "rtas-cli-all-global-"));
  try {
    const result = await execFileAsync(
      process.execPath,
      [cliPath, "install", "claude", "--all", "--global"],
      {
        cwd: process.cwd(),
        env: { ...process.env, HOME: home, USERPROFILE: home },
      },
    );
    assert.match(result.stdout, /Installed app-engineering-router/);

    const skillRoot = join(home, ".claude", "skills");
    assert.equal((await readdir(skillRoot)).length, 18);
    const router = await readFile(join(skillRoot, "app-engineering-router", "SKILL.md"), "utf8");
    assert.match(router, /^---\nname:\s*app-engineering-router/m);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("CLI install --all --global without agent writes every skill to default global path", async () => {
  const home = await mkdtemp(join(tmpdir(), "rtas-cli-all-global-default-"));
  try {
    const result = await execFileAsync(
      process.execPath,
      [cliPath, "install", "--all", "--global"],
      {
        cwd: process.cwd(),
        env: { ...process.env, HOME: home, USERPROFILE: home },
      },
    );
    assert.match(result.stdout, /Installed app-engineering-router/);

    const skillRoot = join(home, ".agents", "skills", "rust-tauri-agent-skills");
    assert.equal((await readdir(skillRoot)).length, 18);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("CLI install --all --force re-installs every skill at default local path", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-cli-all-force-"));
  try {
    const first = await execFileAsync(process.execPath, [cliPath, "install", "--all"], {
      cwd: workspace,
    });
    assert.match(first.stdout, /Installed app-engineering-router/);

    const second = await execFileAsync(process.execPath, [cliPath, "install", "--all"], {
      cwd: workspace,
    });
    assert.match(second.stderr, /Skipping existing skill: app-engineering-router/);

    const forced = await execFileAsync(
      process.execPath,
      [cliPath, "install", "--all", "--force"],
      { cwd: workspace },
    );
    assert.match(forced.stdout, /Installed app-engineering-router/);
    assert.equal(forced.stdout.split("\n").filter((line) => line.startsWith("Installed ")).length, 18);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("CLI install with raw path still works as fallback", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-cli-raw-"));
  try {
    const customDir = join(workspace, "my", "custom", "skills");
    const result = await execFileAsync(process.execPath, [cliPath, "install", customDir], {
      cwd: process.cwd(),
    });
    assert.match(result.stdout, /Installed rust-tauri/);

    const router = await readFile(join(customDir, "rust-tauri", "SKILL.md"), "utf8");
    assert.match(router, /^---\nname:\s*rust-tauri/m);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("CLI install with unknown agent name treats it as raw destination path", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-cli-unknown-"));
  try {
    const dest = join(workspace, "custom-agent-skills");
    const result = await execFileAsync(process.execPath, [cliPath, "install", dest], {
      cwd: process.cwd(),
    });
    assert.match(result.stdout, /Installed rust-tauri/);

    const router = await readFile(join(dest, "rust-tauri", "SKILL.md"), "utf8");
    assert.match(router, /^---\nname:\s*rust-tauri/m);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("CLI install without destination installs to default local path", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-cli-default-"));
  try {
    const result = await execFileAsync(process.execPath, [cliPath, "install"], {
      cwd: workspace,
    });
    assert.match(result.stdout, /Installed rust-tauri/);

    const router = await readFile(
      join(workspace, ".agents", "skills", "rust-tauri-agent-skills", "rust-tauri", "SKILL.md"),
      "utf8",
    );
    assert.match(router, /^---\nname:\s*rust-tauri/m);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("CLI install --global without destination installs to default global path", async () => {
  const home = await mkdtemp(join(tmpdir(), "rtas-cli-default-global-"));
  try {
    const result = await execFileAsync(process.execPath, [cliPath, "install", "--global"], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.match(result.stdout, /Installed rust-tauri/);

    const router = await readFile(
      join(home, ".agents", "skills", "rust-tauri-agent-skills", "rust-tauri", "SKILL.md"),
      "utf8",
    );
    assert.match(router, /^---\nname:\s*rust-tauri/m);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("resolveDefaultDestination returns default local and global paths", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-default-resolve-"));
  try {
    assert.equal(
      resolveDefaultDestination(false, workspace),
      join(workspace, ".agents", "skills", "rust-tauri-agent-skills"),
    );
    assert.equal(
      resolveDefaultDestination(true),
      resolve(homedir(), ".agents", "skills", "rust-tauri-agent-skills"),
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("skill list exposes package metadata", async () => {
  const skills = await listSkills();
  assert.equal(skills.length, 18);
  assert.equal(skills[0].name, "accessible-responsive-ui");
  assert.ok(skills.every((skill) => skill.description.length > 0));
});

test("validation checks skill folder against frontmatter name", async () => {
  const skillsDir = await mkdtemp(join(tmpdir(), "rtas-invalid-skills-"));
  try {
    const skillDir = join(skillsDir, "actual-folder");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: declared-name\ndescription: test skill\n---\n\nBody.\n",
      "utf8",
    );

    const result = await validateSkills(skillsDir);
    assert.ok(result.errors.some((error) => error.includes("does not match folder")));
  } finally {
    await rm(skillsDir, { recursive: true, force: true });
  }
});

test("CLI supports rust-tauri alias and rejects missing workspace value", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-cli-workspace-"));
  try {
    const enabled = await execFileAsync(process.execPath, ["dist/cli.js", "on", "--workspace", workspace], {
      cwd: process.cwd(),
    });
    assert.match(enabled.stdout, /Rust Tauri skills ON/);

    await assert.rejects(
      execFileAsync(process.execPath, ["dist/cli.js", "rust-tauri", "on", "--workspace"]),
      /Missing value for --workspace/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("rust-tauri workspace mode only edits target workspace managed block", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-workspace-"));
  try {
    const enabled = await setRustTauriWorkspaceMode(workspace, true);
    assert.equal(enabled.enabled, true);

    const agents = await readFile(join(workspace, "AGENTS.md"), "utf8");
    assert.match(agents, /rust-tauri-agent-skills:start/);
    assert.match(agents, /rust-tauri/);
    assert.match(agents, /\.codex\/agent-skills\/rust-tauri\/SKILL\.md/);
    assert.match(agents, /\.gemini\/skills\/rust-tauri\/SKILL\.md/);

    const status = await getRustTauriWorkspaceMode(workspace);
    assert.equal(status.enabled, true);

    const disabled = await setRustTauriWorkspaceMode(workspace, false);
    assert.equal(disabled.enabled, false);

    const after = await readFile(join(workspace, ".rust-tauri-agent-skills", "state.json"), "utf8");
    assert.match(after, /"enabled": false/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
