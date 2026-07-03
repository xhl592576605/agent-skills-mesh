import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { describe, expect, test } from "vitest";
import type { AppConfig } from "../../src/core/models/config.js";
import type { IndexFile } from "../../src/core/models/index.js";
import type { InstallationRecord, InstallationStatus } from "../../src/core/models/installation.js";
import type { SkillRecord } from "../../src/core/models/skill.js";
import { useInstallPlan } from "../../src/tui/hooks/useInstallPlan.js";
import type { PendingIntent } from "../../src/tui/state/types.js";

// ---- harness: 在 Ink 渲染上下文里捕获 hook 返回值（.ts 文件，用 createElement 避免 JSX）----

function captureHook<T>(fn: () => T): T {
  let value: T | undefined;
  function Probe(): null {
    value = fn();
    return null;
  }
  render(createElement(Probe));
  if (value === undefined) throw new Error("hook value not captured");
  return value;
}

// ---- fixtures --------------------------------------------------------------

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "asm-tui-plan-"));
}

function configWith(agentDir: string, sourcePath = path.dirname(agentDir)): AppConfig {
  const home = path.join(agentDir, ".asm-home");
  return {
    version: 1,
    settings: { install_strategy: "symlink", default_agent: "pi", auto_refresh_on_start: true },
    paths: { home, repos: path.join(home, "repos"), local: path.join(home, "local"), cache: path.join(home, "cache"), skills: path.join(home, "skills") },
    sources: [{ id: "s1", name: "Source", type: "local-dir", path: sourcePath, enabled: true }],
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
        id: "c1",
        skillName: name,
        sourceId: "s1",
        sourceType: "local-dir",
        path: sourcePath,
        entry: "SKILL.md",
        tags: [],
        hash: "h",
        mtimeMs: 1,
        size: 1,
        origin: "configured-source",
        managed: true
      }
    ]
  };
}

function indexWith(skill: SkillRecord, installations: Record<string, InstallationRecord> = {}): IndexFile {
  return { version: 1, updatedAt: new Date().toISOString(), sources: {}, skills: { [skill.name]: skill }, installations, issues: [] };
}

function installation(skillName: string, agentId: string, status: InstallationStatus): InstallationRecord {
  return { id: `${skillName}:${agentId}`, skillName, agentId, status, targetPath: `/tmp/${agentId}/${skillName}` };
}

function pendingOf(entries: Array<[string, string, PendingIntent]>): Map<string, Map<string, PendingIntent>> {
  const map = new Map<string, Map<string, PendingIntent>>();
  for (const [skill, agent, intent] of entries) {
    if (!map.has(skill)) map.set(skill, new Map());
    map.get(skill)!.set(agent, intent);
  }
  return map;
}

// ---- tests -----------------------------------------------------------------

describe("useInstallPlan.buildReview", () => {
  test("aggregates install plan with create-symlink and no conflict", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    const cfg = configWith(agentDir, source);
    const idx = indexWith(skillRecord("foo", source));

    let refreshCalls = 0;
    const api = captureHook(() => useInstallPlan(async () => { refreshCalls += 1; return idx; }));

    const review = await api.buildReview(cfg, idx, pendingOf([["foo", "pi", "install"]]));
    expect(review.entries).toHaveLength(1);
    expect(review.entries[0].intent).toBe("install");
    expect(review.entries[0].plan.hasConflict).toBe(false);
    expect(review.entries[0].plan.actions.map((action) => action.type)).toEqual(["copy-to-ssot", "create-symlink", "update-state"]);
    expect(review.conflicts).toBe(0);
    expect(refreshCalls).toBe(0); // buildReview 不触发 refresh。
  });

  test("reports conflict when install target is a real directory", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    await fs.mkdir(path.join(agentDir, "foo")); // 真实目录 → conflict。
    const cfg = configWith(agentDir, source);
    const idx = indexWith(skillRecord("foo", source));
    const api = captureHook(() => useInstallPlan(async () => idx));

    const review = await api.buildReview(cfg, idx, pendingOf([["foo", "pi", "install"]]));
    expect(review.entries[0].plan.hasConflict).toBe(true);
    expect(review.conflicts).toBe(1);
  });
});

describe("useInstallPlan.applyAll", () => {
  test("applies non-conflict plan, creates symlink, calls refresh, returns counts", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    const cfg = configWith(agentDir, source);
    const idx = indexWith(skillRecord("foo", source));
    const refreshed: IndexFile = { ...idx, installations: { "foo:pi": installation("foo", "pi", "installed") } };
    let refreshCalls = 0;
    const api = captureHook(() => useInstallPlan(async () => { refreshCalls += 1; return refreshed; }));

    const outcome = await api.applyAll(cfg, idx, pendingOf([["foo", "pi", "install"]]));

    expect(outcome.applied).toBe(1);
    expect(outcome.skipped).toBe(0);
    expect(outcome.newIndex).toBe(refreshed);
    expect(refreshCalls).toBe(1);
    expect((await fs.lstat(path.join(agentDir, "foo"))).isSymbolicLink()).toBe(true);
  });

  test("skips conflicted plan without creating symlink", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    await fs.mkdir(path.join(agentDir, "foo")); // 真实目录 → conflict，apply 跳过。
    const cfg = configWith(agentDir, source);
    const idx = indexWith(skillRecord("foo", source));
    const api = captureHook(() => useInstallPlan(async () => idx));

    const outcome = await api.applyAll(cfg, idx, pendingOf([["foo", "pi", "install"]]));

    expect(outcome.applied).toBe(0);
    expect(outcome.skipped).toBe(1);
    // 真实目录未被删除/替换。
    const stat = await fs.lstat(path.join(agentDir, "foo"));
    expect(stat.isDirectory()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
  });

  test("applies uninstall plan and removes existing symlink", async () => {
    const source = await tempDir();
    const agentDir = await tempDir();
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");
    // 预置一个已安装 symlink（供 uninstall）。
    await fs.symlink(source, path.join(agentDir, "foo"), "dir");
    const cfg = configWith(agentDir, source);
    const idx = indexWith(skillRecord("foo", source));
    const api = captureHook(() => useInstallPlan(async () => idx));

    const outcome = await api.applyAll(cfg, idx, pendingOf([["foo", "pi", "uninstall"]]));

    expect(outcome.applied).toBe(1);
    expect(outcome.skipped).toBe(0);
    await expect(fs.lstat(path.join(agentDir, "foo"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
