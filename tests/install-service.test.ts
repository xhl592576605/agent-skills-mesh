import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { AppConfig } from "../src/core/models/config.js";
import type { IndexFile } from "../src/core/models/index.js";
import type { SkillRecord } from "../src/core/models/skill.js";
import { applyInstallPlan, applyRepairPlan, applyUninstallPlan, buildInstallPlan, buildRepairPlan, buildUninstallPlan, detectInstallation } from "../src/core/services/install-service.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "asm-install-"));
}

function config(agentDir: string): AppConfig {
  return {
    version: 1,
    settings: { install_strategy: "symlink", default_agent: "pi", auto_refresh_on_start: true },
    paths: { home: "", repos: "", local: "", cache: "" },
    sources: [],
    agents: { pi: { name: "Pi", enabled: true, skills_dir: agentDir } }
  };
}

function skillRecord(name: string, sourcePath: string): SkillRecord {
  return {
    name,
    displayName: name,
    status: "managed",
    tags: [],
    candidates: [
      {
        id: "candidate-1",
        skillName: name,
        sourceId: "source-1",
        sourceType: "local-dir",
        path: sourcePath,
        entry: "SKILL.md",
        tags: [],
        hash: "hash",
        mtimeMs: 1,
        size: 1,
        origin: "configured-source",
        managed: true
      }
    ]
  };
}

function indexWith(skill: SkillRecord): IndexFile {
  return { version: 1, updatedAt: new Date().toISOString(), sources: {}, skills: { [skill.name]: skill }, installations: {}, issues: [] };
}

describe("install service", () => {
  test("creates symlink when target is missing", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    const skill = skillRecord("foo", source);
    const plan = await buildInstallPlan(config(agentDir), indexWith(skill), "foo", "pi");
    expect(plan.actions[0].type).toBe("create-symlink");
    await applyInstallPlan(plan);
    expect((await fs.lstat(path.join(agentDir, "foo"))).isSymbolicLink()).toBe(true);
  });

  test("skips existing same symlink", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    await fs.symlink(source, path.join(agentDir, "foo"), "dir");
    const plan = await buildInstallPlan(config(agentDir), indexWith(skillRecord("foo", source)), "foo", "pi");
    expect(plan.actions[0]).toMatchObject({ type: "skip" });
  });

  test("conflicts on real directory", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    await fs.mkdir(path.join(agentDir, "foo"));
    const plan = await buildInstallPlan(config(agentDir), indexWith(skillRecord("foo", source)), "foo", "pi");
    expect(plan.hasConflict).toBe(true);
    expect(plan.actions[0].type).toBe("conflict");
  });

  test("detects broken symlink", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    await fs.symlink(path.join(agentDir, "missing"), path.join(agentDir, "foo"), "dir");
    const detected = await detectInstallation(skillRecord("foo", source), "pi", agentDir);
    expect(detected.status).toBe("broken-link");
  });

  test("uninstall deletes symlink only", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.symlink(source, path.join(agentDir, "foo"), "dir");
    const plan = await buildUninstallPlan(config(agentDir), "foo", "pi");
    expect(plan.hasConflict).toBe(false);
    expect(plan.actions[0]).toMatchObject({ type: "skip", reason: "remove symlink" });
    await applyUninstallPlan(plan);
    await expect(fs.lstat(path.join(agentDir, "foo"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.lstat(source)).resolves.toBeDefined();
  });
});

describe("repair service", () => {
  test("builds a repairable plan and rebuilds symlink to the candidate", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    const targetPath = path.join(agentDir, "foo");
    // 先建一个指向 missing 路径的 symlink，模拟 broken-link。
    await fs.symlink(path.join(agentDir, "missing"), targetPath, "dir");

    const plan = await buildRepairPlan(config(agentDir), indexWith(skillRecord("foo", source)), "foo", "pi");
    expect(plan.hasConflict).toBe(false);
    expect(plan.newTarget).toBe(source);

    await applyRepairPlan(plan);
    const stat = await fs.lstat(targetPath);
    expect(stat.isSymbolicLink()).toBe(true);
    expect(await fs.readlink(targetPath)).toBe(source);
  });

  test("conflicts when target is a real directory", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    await fs.mkdir(path.join(agentDir, "foo"));

    const plan = await buildRepairPlan(config(agentDir), indexWith(skillRecord("foo", source)), "foo", "pi");
    expect(plan.hasConflict).toBe(true);
    expect(plan.warnings.some((w) => /real directory/i.test(w))).toBe(true);
    await expect(applyRepairPlan(plan)).rejects.toThrow(/conflicts/);
  });

  test("conflicts when target does not exist", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");

    const plan = await buildRepairPlan(config(agentDir), indexWith(skillRecord("foo", source)), "foo", "pi");
    expect(plan.hasConflict).toBe(true);
    expect(plan.warnings.some((w) => /nothing to repair/i.test(w))).toBe(true);
  });

  test("conflicts when agent is disabled", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    await fs.symlink(path.join(agentDir, "missing"), path.join(agentDir, "foo"), "dir");
    const disabledConfig: AppConfig = {
      ...config(agentDir),
      agents: { pi: { name: "Pi", enabled: false, skills_dir: agentDir } }
    };

    const plan = await buildRepairPlan(disabledConfig, indexWith(skillRecord("foo", source)), "foo", "pi");
    expect(plan.hasConflict).toBe(true);
    expect(plan.warnings.some((w) => /disabled/i.test(w))).toBe(true);
  });
});
