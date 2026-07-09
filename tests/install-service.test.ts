import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { AppConfig } from "../src/core/models/config.js";
import type { IndexFile } from "../src/core/models/index.js";
import type { SkillRecord } from "../src/core/models/skill.js";
import { applyInstallPlan, applyRepairPlan, applyUninstallPlan, buildInstallPlan, buildRepairPlan, buildUninstallPlan, detectInstallation } from "../src/core/services/install-service.js";
import { StateStore } from "../src/core/storage/state-store.js";
import { isBizError } from "../src/core/errors.js";
import type { InstallPlan, RepairPlan, UninstallPlan } from "../src/core/models/install-plan.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "asm-install-"));
}

function config(agentDir: string, ssotDir = path.join(agentDir, "..", "ssot-skills")): AppConfig {
  const home = path.dirname(ssotDir);
  return {
    version: 1,
    settings: { install_strategy: "symlink", default_agent: "pi", auto_refresh_on_start: true },
    paths: { home, repos: path.join(home, "repos"), local: path.join(home, "local"), cache: path.join(home, "cache"), skills: ssotDir },
    sources: [{ id: "source-1", name: "Source", type: "local-dir", path: path.dirname(ssotDir), enabled: true }],
    agents: { pi: { name: "Pi", enabled: true, skills_dir: agentDir } },
    skillOverrides: {}
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

/** 与 {@link skillRecord} 同结构但清空 candidates，用于触发 NO_INSTALLABLE_CANDIDATE。 */
function skillRecordNoCandidates(name: string): SkillRecord {
  return { ...skillRecord(name, "/unused-source"), candidates: [] };
}

describe("install service", () => {
  test("rejects path traversal skill names before planning filesystem writes", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    const unsafe = skillRecord("../escape", source);
    const cfg = config(agentDir, path.join(await tempDir(), "skills"));
    cfg.sources[0].path = source;

    await expect(buildInstallPlan(cfg, indexWith(unsafe), "../escape", "pi")).rejects.toThrow(/Invalid skill name/);
  });

  test("creates symlink when target is missing", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    const skill = skillRecord("foo", source);
    const cfg = config(agentDir, path.join(await tempDir(), "skills"));
    cfg.sources[0].path = source;
    const stateStore = new StateStore(cfg.paths.home);
    const plan = await buildInstallPlan(cfg, indexWith(skill), "foo", "pi", await stateStore.read());
    expect(plan.actions.map((action) => action.type)).toEqual(["copy-to-ssot", "create-link", "update-state"]);
    await applyInstallPlan(plan, stateStore);
    expect((await fs.lstat(path.join(agentDir, "foo"))).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(path.join(agentDir, "foo"))).toBe(path.join(cfg.paths.skills, "foo"));
    await expect(fs.lstat(path.join(cfg.paths.skills, "foo", "SKILL.md"))).resolves.toBeDefined();
  });

  test("skips existing same symlink", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    const cfg = config(agentDir, path.join(await tempDir(), "skills"));
    cfg.sources[0].path = source;
    const stateStore = new StateStore(cfg.paths.home);
    const installPlan = await buildInstallPlan(cfg, indexWith(skillRecord("foo", source)), "foo", "pi", await stateStore.read());
    await applyInstallPlan(installPlan, stateStore);
    const plan = await buildInstallPlan(cfg, indexWith(skillRecord("foo", source)), "foo", "pi", await stateStore.read());
    expect(plan.actions.some((action) => action.type === "skip")).toBe(true);
  });

  test("second agent install reuses SSOT content", async () => {
    const source = await tempDir();
    const piDir = await tempDir();
    const claudeDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    const cfg = config(piDir, path.join(await tempDir(), "skills"));
    cfg.sources[0].path = source;
    cfg.agents.claude = { name: "Claude", enabled: true, skills_dir: claudeDir };
    const stateStore = new StateStore(cfg.paths.home);

    const first = await buildInstallPlan(cfg, indexWith(skillRecord("foo", source)), "foo", "pi", await stateStore.read());
    await applyInstallPlan(first, stateStore);
    const second = await buildInstallPlan(cfg, indexWith(skillRecord("foo", source)), "foo", "claude", await stateStore.read());

    expect(second.actions.map((action) => action.type)).toEqual(["create-link", "update-state"]);
    await applyInstallPlan(second, stateStore);
    const state = await stateStore.read();
    expect(Object.keys(state.installedSkills.foo.enabledAgents).sort()).toEqual(["claude", "pi"]);
    expect(await fs.readlink(path.join(piDir, "foo"))).toBe(path.join(cfg.paths.skills, "foo"));
    expect(await fs.readlink(path.join(claudeDir, "foo"))).toBe(path.join(cfg.paths.skills, "foo"));
  });

  test("conflicts when SSOT target exists without state", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    const cfg = config(agentDir, path.join(await tempDir(), "skills"));
    cfg.sources[0].path = source;
    await fs.mkdir(path.join(cfg.paths.skills, "foo"), { recursive: true });
    await fs.writeFile(path.join(cfg.paths.skills, "foo", "SKILL.md"), "# stale", "utf8");

    const plan = await buildInstallPlan(cfg, indexWith(skillRecord("foo", source)), "foo", "pi");
    expect(plan.hasConflict).toBe(true);
    expect(plan.actions).toContainEqual(expect.objectContaining({ type: "conflict", targetPath: path.join(cfg.paths.skills, "foo") }));
  });

  test("conflicts on real directory", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    await fs.mkdir(path.join(agentDir, "foo"));
    const cfg = config(agentDir, path.join(await tempDir(), "skills"));
    cfg.sources[0].path = source;
    const plan = await buildInstallPlan(cfg, indexWith(skillRecord("foo", source)), "foo", "pi");
    expect(plan.hasConflict).toBe(true);
    expect(plan.actions.some((action) => action.type === "conflict")).toBe(true);
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
    expect(plan.actions[0]).toMatchObject({ type: "remove-link" });
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

describe("install service error codes", () => {
  // 捕获 throw 并断言为 BizError + code，替代 message 字符串断言（Phase B 错误码体系）。
  async function capture(fn: () => Promise<unknown>): Promise<unknown> {
    try {
      await fn();
    } catch (e) {
      return e;
    }
    throw new Error("expected rejection but none was thrown");
  }

  test("buildInstallPlan throws SKILL_NOT_FOUND for unknown skill", async () => {
    const cfg = config(await tempDir());
    const emptyIndex: IndexFile = { version: 1, updatedAt: new Date().toISOString(), sources: {}, skills: {}, installations: {}, issues: [] };
    const err = await capture(() => buildInstallPlan(cfg, emptyIndex, "nope", "pi"));
    expect(isBizError(err)).toBe(true);
    expect((err as { code: string }).code).toBe("SKILL_NOT_FOUND");
    // 英文兌底 message 保留，供日志与非 i18n 场景。
    expect((err as Error).message).toBe("Skill not found: nope");
    expect((err as { params: Record<string, string | number> }).params).toEqual({ name: "nope" });
  });

  test("buildInstallPlan throws AGENT_NOT_FOUND for unknown agent", async () => {
    const source = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    const cfg = config(await tempDir());
    cfg.sources[0].path = source;
    const err = await capture(() => buildInstallPlan(cfg, indexWith(skillRecord("foo", source)), "foo", "ghost"));
    expect(isBizError(err)).toBe(true);
    expect((err as { code: string }).code).toBe("AGENT_NOT_FOUND");
    expect((err as { params: Record<string, string | number> }).params).toEqual({ id: "ghost" });
  });

  test("buildInstallPlan throws NO_INSTALLABLE_CANDIDATE when skill has no candidates", async () => {
    const cfg = config(await tempDir());
    const err = await capture(() => buildInstallPlan(cfg, indexWith(skillRecordNoCandidates("foo")), "foo", "pi"));
    expect(isBizError(err)).toBe(true);
    expect((err as { code: string }).code).toBe("NO_INSTALLABLE_CANDIDATE");
    expect((err as { params: Record<string, string | number> }).params).toEqual({ name: "foo" });
  });

  test("buildRepairPlan throws SKILL_NOT_FOUND for unknown skill", async () => {
    const cfg = config(await tempDir());
    const emptyIndex: IndexFile = { version: 1, updatedAt: new Date().toISOString(), sources: {}, skills: {}, installations: {}, issues: [] };
    const err = await capture(() => buildRepairPlan(cfg, emptyIndex, "nope", "pi"));
    expect(isBizError(err)).toBe(true);
    expect((err as { code: string }).code).toBe("SKILL_NOT_FOUND");
  });

  test("applyInstallPlan throws INSTALL_PLAN_CONFLICT on conflicted plan", async () => {
    const plan = { id: "x", skillName: "foo", actions: [], hasConflict: true, warnings: [] } as unknown as InstallPlan;
    const err = await capture(() => applyInstallPlan(plan));
    expect(isBizError(err)).toBe(true);
    expect((err as { code: string }).code).toBe("INSTALL_PLAN_CONFLICT");
  });

  test("applyUninstallPlan throws UNINSTALL_PLAN_CONFLICT on conflicted plan", async () => {
    const plan = { id: "x", skillName: "foo", actions: [], hasConflict: true, warnings: [] } as unknown as UninstallPlan;
    const err = await capture(() => applyUninstallPlan(plan));
    expect(isBizError(err)).toBe(true);
    expect((err as { code: string }).code).toBe("UNINSTALL_PLAN_CONFLICT");
  });

  test("applyRepairPlan throws REPAIR_PLAN_CONFLICT on conflicted plan", async () => {
    const plan = { id: "x", skillName: "foo", agentId: "pi", targetPath: "/x", newTarget: "/y", hasConflict: true, warnings: [] } as unknown as RepairPlan;
    const err = await capture(() => applyRepairPlan(plan));
    expect(isBizError(err)).toBe(true);
    expect((err as { code: string }).code).toBe("REPAIR_PLAN_CONFLICT");
  });

  test("applyRepairPlan throws REPAIR_TARGET_MISSING when target absent", async () => {
    const plan = { id: "x", skillName: "foo", agentId: "pi", targetPath: path.join(await tempDir(), "missing"), newTarget: "/y", hasConflict: false, warnings: [] } as unknown as RepairPlan;
    const err = await capture(() => applyRepairPlan(plan));
    expect(isBizError(err)).toBe(true);
    expect((err as { code: string }).code).toBe("REPAIR_TARGET_MISSING");
    expect((err as { params: Record<string, string | number> }).params).toMatchObject({ path: plan.targetPath });
  });
});
