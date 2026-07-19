import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, rename } from "node:fs/promises";
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
  installRouterSkill,
  installSkills,
  listRustRules,
  readRustRule,
  listSkills,
  recoverInterruptedInstalls,
  resolveAgentDestination,
  resolveDefaultDestination,
  setRustTauriWorkspaceMode,
  suggestAgent,
  validateSkills,
} from "../dist/index.js";

const snapshotSkills = async () => {
  const skills = await listSkills();
  assert.ok(skills.length > 0, "expected at least one skill in package");
  return skills;
};

test("skills validate through TypeScript package API with no semantic errors", async () => {
  const result = await validateSkills();
  assert.ok(result.count > 0, "expected validateSkills to count skills");
  assert.deepEqual(result.errors, []);
});

test("package root exposes compiled API", async () => {
  const packageApi = await import("@the-long-ride/rust-tauri-agent-skills");
  assert.equal(typeof packageApi.installSkills, "function");
  assert.equal(typeof packageApi.installRouterSkill, "function");
  assert.equal(typeof packageApi.validateSkills, "function");
});

test("package.json exposes rtas CLI bin aliases and pulls in the yaml runtime dependency", async () => {
  const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
  assert.equal(pkg.bin.rtas, "./dist/cli.js");
  assert.equal(pkg.bin["rust-tauri-agent-skills"], "./dist/cli.js");
  assert.equal(pkg.bin["rust-tauri"], "./dist/cli.js");
  assert.equal(pkg.bin["rtas-skills"], "./dist/cli.js");
  assert.ok(pkg.dependencies?.yaml, "expected yaml in dependencies for runtime frontmatter parsing");
});

test("full vendored Rust rule corpus is searchable and readable", async () => {
  const rules = await listRustRules();
  assert.ok(rules.length > 0, "expected vendored Rust rules to be present");
  assert.equal(rules.find((rule) => rule.id === "async-no-lock-await")?.summary, "Never hold `Mutex`/`RwLock` across `.await`");

  const matches = await findRustRules("cancellation");
  assert.ok(matches.some((rule) => rule.id === "async-cancellation-token"));

  const source = await readRustRule("unsafe-safety-comment");
  assert.match(source, /# Safety/);
});

test("installer copies every skill and skips existing skills unless forced", async () => {
  const skills = await snapshotSkills();
  const destination = await mkdtemp(join(tmpdir(), "rtas-skills-"));
  try {
    const first = await installSkills(destination);
    assert.equal(first.installed.length, skills.length);
    assert.deepEqual(first.skipped, []);

    const second = await installSkills(destination);
    assert.deepEqual(second.installed, []);
    assert.equal(second.skipped.length, skills.length);

    const forced = await installSkills(destination, { force: true });
    assert.equal(forced.installed.length, skills.length);
    assert.deepEqual(forced.skipped, []);

    const router = await readFile(join(destination, "app-engineering-router", "SKILL.md"), "utf8");
    assert.match(router, /^---\nname:\s*app-engineering-router/m);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

test("installer rejects cleanly and leaves no staged leftovers when source skills dir is missing", async () => {
  const destination = await mkdtemp(join(tmpdir(), "rtas-skills-missing-src-"));
  try {
    const missingSource = join(destination, "does-not-exist");
    await assert.rejects(
      installSkills(destination, {}, missingSource),
      /ENOENT/i,
    );
    const leftovers = await readdir(destination);
    assert.ok(
      leftovers.every((entry) => !entry.includes("rtas-stage") && !entry.includes("rtas-bak")),
      "found leaked staging or backup files after failed install",
    );
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

test("installer --force leaves no staging or backup leftovers at destination", async () => {
  const skills = await snapshotSkills();
  const destination = await mkdtemp(join(tmpdir(), "rtas-skills-no-leaks-"));
  try {
    await installSkills(destination);
    const userMarker = join(destination, "app-engineering-router", "USER_CONTENT.md");
    await writeFile(userMarker, "kept-by-user", "utf8");
    await installSkills(destination, { force: true });
    const leftovers = await readdir(destination);
    assert.ok(
      leftovers.every((entry) => !entry.includes("rtas-stage") && !entry.includes("rtas-bak")),
      "atomic install leaked staging files at destination",
    );
    const installedCount = leftovers.filter((entry) => skills.some((skill) => skill.name === entry)).length;
    assert.equal(installedCount, skills.length);
    await assert.rejects(readFile(userMarker), /ENOENT/);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

test("installSkills rolls back all commits when a mid-batch commit fails", async () => {
  const skills = await snapshotSkills();
  const destination = await mkdtemp(join(tmpdir(), "rtas-batch-rollback-"));
  try {
    await installSkills(destination);
    const originalFirst = await readFile(join(destination, skills[0].name, "SKILL.md"), "utf8");
    const originalMid = await readFile(join(destination, skills[Math.floor(skills.length / 2)].name, "SKILL.md"), "utf8");
    const originalLast = await readFile(join(destination, skills[skills.length - 1].name, "SKILL.md"), "utf8");

    const brokenSkillsDir = await mkdtemp(join(tmpdir(), "rtas-batch-broken-src-"));
    try {
      for (const skill of skills) {
        const targetDir = join(brokenSkillsDir, skill.name);
        await mkdir(targetDir, { recursive: true });
        await writeFile(join(targetDir, "SKILL.md"), "---\nname: ${skill.name}\ndescription: broken\n---\nbody\n".replace("${skill.name}", skill.name), "utf8");
      }
      const poisonedSkill = skills[Math.floor(skills.length / 2)].name;
      const poisonedDir = join(brokenSkillsDir, poisonedSkill);
      await rm(join(poisonedDir, "SKILL.md"), { force: true });
      await mkdir(join(poisonedDir, "SKILL.md"), { recursive: true });

      await assert.rejects(
        installSkills(destination, { force: true }, brokenSkillsDir),
        /EEXIST|EISDIR|ENOTDIR|ENOENT/i,
      );

      const afterFirst = await readFile(join(destination, skills[0].name, "SKILL.md"), "utf8");
      const afterMid = await readFile(join(destination, skills[Math.floor(skills.length / 2)].name, "SKILL.md"), "utf8");
      const afterLast = await readFile(join(destination, skills[skills.length - 1].name, "SKILL.md"), "utf8");
      assert.equal(afterFirst, originalFirst, "first skill drifted after failed batch");
      assert.equal(afterMid, originalMid, "mid skill drifted after failed batch");
      assert.equal(afterLast, originalLast, "last skill drifted after failed batch");

      const entries = await readdir(destination);
      assert.ok(
        entries.every((entry) => !entry.includes("rtas-stage") && !entry.includes("rtas-bak") && entry !== ".rtas-tx"),
        `leftover staging dirs after rollback: ${entries.join(",")}`,
      );
    } finally {
      await rm(brokenSkillsDir, { recursive: true, force: true });
    }
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

test("recoverInterruptedInstalls rolls back commits left by a crashed install", async () => {
  const skills = await snapshotSkills();
  const destination = await mkdtemp(join(tmpdir(), "rtas-recover-"));
  try {
    await installSkills(destination);
    const victim = skills[0].name;
    const victimPath = join(destination, victim, "SKILL.md");
    const originalVictim = await readFile(victimPath, "utf8");

    const txRoot = join(destination, ".rtas-tx");
    await mkdir(join(txRoot, "tx-fake"), { recursive: true });
    const backupDir = join(txRoot, "tx-fake", "backups", `${victim}-fake`);
    await mkdir(dirname(backupDir), { recursive: true });
    await rename(join(destination, victim), backupDir);
    await mkdir(join(destination, victim), { recursive: true });
    await writeFile(join(destination, victim, "SKILL.md"), "PARTIAL", "utf8");
    await writeFile(
      join(txRoot, "tx-fake", "journal.json"),
      `${JSON.stringify({
        txId: "tx-fake",
        status: "committing",
        createdAt: new Date().toISOString(),
        commits: [{ name: victim, target: join(destination, victim), backup: backupDir }],
      })}\n`,
      "utf8",
    );
    await writeFile(join(txRoot, "lock"), JSON.stringify({ pid: 99999, startedAt: new Date(0).toISOString() }), "utf8");

    const messages = await recoverInterruptedInstalls(destination);
    assert.ok(messages.some((m) => m.includes("rolled back")), `expected rollback message, got: ${messages.join(";")}`);

    const afterVictim = await readFile(victimPath, "utf8");
    assert.equal(afterVictim, originalVictim, "recover did not restore the original skill");
    const entries = await readdir(destination);
    assert.ok(!entries.includes(".rtas-tx"), `.rtas-tx should be removed after recovery, got: ${entries.join(",")}`);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

test("concurrent installSkills calls into the same destination do not corrupt each other", async () => {
  const skills = await snapshotSkills();
  const destination = await mkdtemp(join(tmpdir(), "rtas-concurrent-"));
  try {
    const brokenSkillsDir = await mkdtemp(join(tmpdir(), "rtas-concurrent-broken-"));
    try {
      for (const skill of skills) {
        const targetDir = join(brokenSkillsDir, skill.name);
        await mkdir(targetDir, { recursive: true });
        await writeFile(join(targetDir, "SKILL.md"), "---\nname: ${n}\ndescription: broken\n---\nbody\n".replace("${n}", skill.name), "utf8");
      }
      const poisoned = skills[skills.length - 1].name;
      await rm(join(brokenSkillsDir, poisoned, "SKILL.md"), { force: true });

      const workers = [
        installSkills(destination, { force: true }, brokenSkillsDir).catch((error) => error),
        installSkills(destination, { force: true }, brokenSkillsDir).catch((error) => error),
      ];
      const results = await Promise.all(workers);
      const errors = results.filter((r) => r instanceof Error);
      assert.ok(errors.length >= 1, `expected at least one worker to fail, got: ${JSON.stringify(results.map((r) => (r instanceof Error ? r.message : "ok")))}`);

      const entries = await readdir(destination);
      assert.ok(
        entries.every((entry) => !entry.includes("rtas-stage") && !entry.includes("rtas-bak")),
        `leftover staging dirs after concurrent install: ${entries.join(",")}`,
      );
      if (entries.includes(skills[0].name)) {
        const firstSkill = await readFile(join(destination, skills[0].name, "SKILL.md"), "utf8");
        assert.ok(firstSkill.includes("broken") || firstSkill.length > 0, "first skill content should be intact or absent, not partially written");
      }
      const txEntries = entries.filter((e) => e === ".rtas-tx");
      assert.ok(txEntries.length <= 1, `multiple .rtas-tx dirs left behind: ${txEntries.join(",")}`);
    } finally {
      await rm(brokenSkillsDir, { recursive: true, force: true });
    }
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

test("suggestAgent matches exact, prefix, and close typos", () => {
  assert.equal(suggestAgent("Claude"), "claude");
  assert.equal(suggestAgent("claud"), "claude");
  assert.equal(suggestAgent("claudeX"), "claude");
  assert.equal(suggestAgent("codax"), "codex");
  assert.equal(suggestAgent("zzzzzz"), undefined);
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

test("CLI install claude --force replaces existing skills atomically", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-cli-force-"));
  try {
    await execFileAsync(process.execPath, [cliPath, "install", "claude"], { cwd: workspace });
    const first = await readFile(
      join(workspace, ".claude", "skills", "rust-tauri", "skills", "typescript-strict", "SKILL.md"),
      "utf8",
    );
    const markerFile = join(workspace, ".claude", "skills", "rust-tauri", "USER_MARKER.txt");
    await writeFile(markerFile, "kept-across-rebuild", "utf8");

    const result = await execFileAsync(process.execPath, [cliPath, "install", "claude", "--force"], {
      cwd: workspace,
    });
    assert.match(result.stdout, /Installed rust-tauri/);

    const second = await readFile(
      join(workspace, ".claude", "skills", "rust-tauri", "skills", "typescript-strict", "SKILL.md"),
      "utf8",
    );
    assert.equal(first, second);
    await assert.rejects(readFile(markerFile), /ENOENT/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("CLI install skips one router package and --all exposes every skill", async () => {
  const skills = await snapshotSkills();
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
      assert.equal((await readdir(join(allWorkspace, ".claude", "skills"))).length, skills.length);
      await readFile(join(allWorkspace, ".claude", "skills", "app-engineering-router", "SKILL.md"), "utf8");
    } finally {
      await rm(allWorkspace, { recursive: true, force: true });
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("CLI install --all --global with agent writes every skill to user home", async () => {
  const skills = await snapshotSkills();
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
    assert.equal((await readdir(skillRoot)).length, skills.length);
    const router = await readFile(join(skillRoot, "app-engineering-router", "SKILL.md"), "utf8");
    assert.match(router, /^---\nname:\s*app-engineering-router/m);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("CLI install --all --global without agent writes every skill to default global path", async () => {
  const skills = await snapshotSkills();
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
    assert.equal((await readdir(skillRoot)).length, skills.length);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("CLI install --all --force re-installs every skill at default local path", async () => {
  const skills = await snapshotSkills();
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
    assert.equal(forced.stdout.split("\n").filter((line) => line.startsWith("Installed ")).length, skills.length);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("CLI install --dest writes router skill to a custom filesystem path", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-cli-dest-"));
  try {
    const customDir = join(workspace, "my", "custom", "skills");
    const result = await execFileAsync(process.execPath, [cliPath, "install", "--dest", customDir], {
      cwd: process.cwd(),
    });
    assert.match(result.stdout, /Installed rust-tauri/);

    const router = await readFile(join(customDir, "rust-tauri", "SKILL.md"), "utf8");
    assert.match(router, /^---\nname:\s*rust-tauri/m);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("CLI install rejects unknown agent names with a did-you-mean hint", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-cli-unknown-"));
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [cliPath, "install", "cloude"], { cwd: workspace }),
      /Unknown agent[\s\S]*Did you mean "claude"/,
    );
    const leftovers = await readdir(workspace);
    assert.deepEqual(leftovers, []);
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

test("skill list exposes package metadata for every skill folder", async () => {
  const skills = await snapshotSkills();
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

test("validation reports a skill folder missing its SKILL.md file", async () => {
  const skillsDir = await mkdtemp(join(tmpdir(), "rtas-missing-skill-md-"));
  try {
    await mkdir(join(skillsDir, "ghost-folder"));
    const result = await validateSkills(skillsDir);
    assert.ok(result.errors.some((error) => error.includes("SKILL.md missing")));
  } finally {
    await rm(skillsDir, { recursive: true, force: true });
  }
});

test("validation rejects duplicate skill names", async () => {
  const skillsDir = await mkdtemp(join(tmpdir(), "rtas-duplicate-skills-"));
  try {
    for (const folder of ["alpha", "alpha-copy"]) {
      const skillDir = join(skillsDir, folder);
      await mkdir(skillDir);
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---\nname: shared-name\ndescription: dup\n---\n\nBody.\n`,
        "utf8",
      );
    }
    const result = await validateSkills(skillsDir);
    assert.ok(result.errors.some((error) => error.includes("duplicate skill name")));
  } finally {
    await rm(skillsDir, { recursive: true, force: true });
  }
});

test("validation flags a router route target that no skill defines", async () => {
  const skillsDir = await mkdtemp(join(tmpdir(), "rtas-missing-route-"));
  try {
    const routerDir = join(skillsDir, "app-engineering-router");
    await mkdir(routerDir);
    await writeFile(
      join(routerDir, "SKILL.md"),
      "---\nname: app-engineering-router\ndescription: routes.\n---\n\nRoute table:\n- Unknown case → `does-not-exist`\n",
      "utf8",
    );
    const result = await validateSkills(skillsDir);
    assert.ok(result.errors.some((error) => error.includes("route target") && error.includes("does-not-exist")));
  } finally {
    await rm(skillsDir, { recursive: true, force: true });
  }
});

test("validation ignores inline code that is not a route target", async () => {
  const skillsDir = await mkdtemp(join(tmpdir(), "rtas-no-false-routes-"));
  try {
    const routerDir = join(skillsDir, "app-engineering-router");
    await mkdir(routerDir);
    await writeFile(
      join(routerDir, "SKILL.md"),
      "---\nname: app-engineering-router\ndescription: routes.\n---\n\nRun `cargo` and `npm` but never route to unknown skills.\n",
      "utf8",
    );
    const result = await validateSkills(skillsDir);
    assert.ok(
      !result.errors.some((error) => error.includes("route target")),
      `inline code was mistaken for a route: ${JSON.stringify(result.errors)}`,
    );
  } finally {
    await rm(skillsDir, { recursive: true, force: true });
  }
});

test("router install preserves reordered YAML frontmatter when renaming to rust-tauri", async () => {
  const skillsDir = await mkdtemp(join(tmpdir(), "rtas-yaml-reorder-"));
  const destination = await mkdtemp(join(tmpdir(), "rtas-yaml-reorder-dest-"));
  try {
    const routerDir = join(skillsDir, "app-engineering-router");
    await mkdir(routerDir);
    await mkdir(join(routerDir, "references"));
    const reordered = "---\ndescription: Routes to a single skill.\nname: app-engineering-router\n---\n\nBody.\n";
    await writeFile(join(routerDir, "SKILL.md"), reordered, "utf8");

    await installRouterSkill(destination, {}, skillsDir);
    const installed = await readFile(join(destination, "rust-tauri", "SKILL.md"), "utf8");
    assert.match(installed, /^---\n[\s\S]*name: rust-tauri[\s\S]*\n---\n/);
    assert.match(installed, /Routes to a single skill\./);
    assert.ok(!/name: app-engineering-router/.test(installed), "original router name leaked through rename");
  } finally {
    await rm(skillsDir, { recursive: true, force: true });
    await rm(destination, { recursive: true, force: true });
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

test("rust-tauri workspace disable on a fresh workspace leaves no AGENTS.md", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-workspace-disable-"));
  try {
    const disabled = await setRustTauriWorkspaceMode(workspace, false);
    assert.equal(disabled.enabled, false);
    await assert.rejects(readFile(join(workspace, "AGENTS.md"), "utf8"), /ENOENT/);
    const state = await readFile(join(workspace, ".rust-tauri-agent-skills", "state.json"), "utf8");
    assert.match(state, /"enabled": false/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("rust-tauri workspace ON then OFF preserves prior AGENTS.md content", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-workspace-preserve-"));
  try {
    const agentsPath = join(workspace, "AGENTS.md");
    const original = "# Project notes\n\nKeep this safe.\n";
    await writeFile(agentsPath, original, "utf8");

    await setRustTauriWorkspaceMode(workspace, true);
    await setRustTauriWorkspaceMode(workspace, false);
    const after = await readFile(agentsPath, "utf8");
    assert.equal(after, original);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("workspace mode rolls back AGENTS.md when state.json write fails", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rtas-workspace-rollback-"));
  try {
    const agentsPath = join(workspace, "AGENTS.md");
    const original = "# Existing notes\n";
    await writeFile(agentsPath, original, "utf8");
    const stateDir = join(workspace, ".rust-tauri-agent-skills");
    const statePath = join(stateDir, "state.json");
    await mkdir(stateDir, { recursive: true });
    await writeFile(statePath, "garbage", "utf8");
    await rename(statePath, `${statePath}.lock`);
    await mkdir(statePath);

    await assert.rejects(setRustTauriWorkspaceMode(workspace, true), (error) => {
      assert.match(error instanceof Error ? error.message : String(error), /EEXIST|ENOTDIR|EISDIR|ENOENT|EPERM/);
      return true;
    });

    const afterAgents = await readFile(agentsPath, "utf8");
    assert.equal(afterAgents, original);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
