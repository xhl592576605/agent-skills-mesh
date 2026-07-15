/**
 * 更新检测服务集成测试（阶段3）：checkSources / checkSkillUpdates。
 *
 * 用真实本地文件系统 + 真实 git repo（不联网），覆盖：
 * - 维度1 本地源：首次 baseline / 内容变化 hasUpdate / 路径缺失降级
 * - 维度1 git 源：clone 后 baseline / remote 新提交后 hasUpdate
 * - 维度2 skill：install 后 updatable=false / 源内容变化后 updatable=true / manual-import 与 orphan 跳过 / sourceId 过滤
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { ConfigStore } from "../src/core/storage/config-store.js";
import { StateStore } from "../src/core/storage/state-store.js";
import { addSource } from "../src/core/services/source-service.js";
import { skillAdd } from "../src/core/services/skill-service.js";
import { refreshIndex } from "../src/core/services/refresh-service.js";
import {
  checkSkillUpdates,
  checkSources,
  isSkillUpdatable,
  isSourceUpdatable
} from "../src/core/services/update-check-service.js";

const execFileAsync = promisify(execFile);

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function setupHome(): Promise<{ home: string; store: ConfigStore; stateStore: StateStore }> {
  const home = await tempDir("asm-uc-home-");
  const store = new ConfigStore(home);
  const stateStore = new StateStore(home);
  const config = await store.init();
  config.paths = {
    home,
    repos: path.join(home, "repos"),
    local: path.join(home, "local"),
    cache: path.join(home, "cache"),
    skills: path.join(home, "skills")
  };
  config.agents = {};
  await store.write(config);
  return { home, store, stateStore };
}

async function writeSkill(dir: string, name: string, body = "body"): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\n${body}\n`, "utf8");
}

/** 建一个含 skill 的本地 folder source，refresh 并 skillAdd 进 SSOT。 */
async function installSkill(store: ConfigStore, stateStore: StateStore, skillName: string, body = "body") {
  const dir = await tempDir(`asm-${skillName}-`);
  const skillDir = path.join(dir, skillName);
  await writeSkill(skillDir, skillName, body);
  const result = await addSource(store, stateStore, dir);
  const index = await refreshIndex(await store.read(), await stateStore.read());
  await skillAdd(store, stateStore, index, skillName);
  return { source: result.source, skillDir, sourceRoot: dir };
}

async function gitIn(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args]);
}
async function commitIn(cwd: string, msg: string): Promise<void> {
  await execFileAsync("git", ["-C", cwd, "commit", "-m", msg]);
}

/** 建一个含一次提交的本地 git remote 仓库（不联网）。 */
async function makeRemoteRepo(): Promise<string> {
  const dir = await tempDir("asm-uc-remote-");
  await execFileAsync("git", ["init", dir]);
  await gitIn(["config", "user.email", "test@example.com"], dir);
  await gitIn(["config", "user.name", "Test"], dir);
  await fs.mkdir(path.join(dir, "my-skill"), { recursive: true });
  await fs.writeFile(path.join(dir, "my-skill", "SKILL.md"), "---\nname: my-skill\n---\nv1\n", "utf8");
  await gitIn(["add", "."], dir);
  await commitIn(dir, "initial");
  return dir;
}

// ─── 维度1：本地源 ───

describe("checkSources (local source)", () => {
  test("首次检测建立 baseline，hasUpdate=false", async () => {
    const { store, stateStore } = await setupHome();
    const { source } = await installSkill(store, stateStore, "foo");

    await checkSources(store, stateStore);
    const state = await stateStore.read();
    const snap = state.sourceSnapshots?.[source.id];
    expect(snap).toBeDefined();
    expect(snap?.fingerprint.length).toBeGreaterThan(0);
    expect(snap?.hasUpdate).toBe(false);
    expect(snap?.error).toBeUndefined();
  });

  test("源内容变化后 hasUpdate=true", async () => {
    const { store, stateStore } = await setupHome();
    const { source, sourceRoot } = await installSkill(store, stateStore, "foo");
    await checkSources(store, stateStore); // baseline

    // 改源目录内容（加新文件 → sha256Directory 变）
    await fs.writeFile(path.join(sourceRoot, "NEW.md"), "change", "utf8");
    await checkSources(store, stateStore);

    const state = await stateStore.read();
    expect(isSourceUpdatable(state.sourceSnapshots ?? {}, source.id)).toBe(true);
    expect(state.sourceSnapshots?.[source.id]?.hasUpdate).toBe(true);
  });

  test("sourceId 过滤：仅检测指定 source", async () => {
    const { store, stateStore } = await setupHome();
    const a = await installSkill(store, stateStore, "alpha");
    const b = await installSkill(store, stateStore, "beta");
    await checkSources(store, stateStore); // 两个都 baseline

    // 只改 a，指定 sourceId 检测 a
    await fs.writeFile(path.join(a.sourceRoot, "NEW.md"), "x", "utf8");
    await checkSources(store, stateStore, a.source.id);

    const state = await stateStore.read();
    expect(state.sourceSnapshots?.[a.source.id]?.hasUpdate).toBe(true);
    expect(state.sourceSnapshots?.[b.source.id]?.hasUpdate).toBe(false);
  });

  test("未知 sourceId 抛 SOURCE_ID_UNKNOWN", async () => {
    const { store, stateStore } = await setupHome();
    await expect(checkSources(store, stateStore, "nope")).rejects.toThrow(/Unknown source id/);
  });
});

// ─── 维度1：git 源 ───

describe("checkSources (git source)", () => {
  test("clone 后 baseline hasUpdate=false；remote 新提交后 hasUpdate=true", async () => {
    const { home, store, stateStore } = await setupHome();
    const remote = await makeRemoteRepo();
    const dest = path.join(home, "repos", "git-src");
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await execFileAsync("git", ["clone", remote, dest]);

    const config = await store.read();
    config.sources.push({
      id: "git-src",
      name: "Git",
      type: "git-repo",
      path: dest,
      url: remote,
      enabled: true,
      readonly: false
    });
    await store.write(config);

    await checkSources(store, stateStore, "git-src");
    let state = await stateStore.read();
    expect(state.sourceSnapshots?.["git-src"]?.hasUpdate).toBe(false);

    // remote 新提交
    await fs.writeFile(path.join(remote, "my-skill", "SKILL.md"), "---\nname: my-skill\n---\nv2\n", "utf8");
    await gitIn(["add", "."], remote);
    await commitIn(remote, "v2");
    await checkSources(store, stateStore, "git-src");

    state = await stateStore.read();
    expect(state.sourceSnapshots?.["git-src"]?.hasUpdate).toBe(true);
  });

  test("未 clone 的 git 源降级为 error snapshot", async () => {
    const { home, store, stateStore } = await setupHome();
    const config = await store.read();
    config.sources.push({
      id: "git-missing",
      name: "Git Missing",
      type: "git-repo",
      path: path.join(home, "repos", "never-cloned"),
      url: "/tmp/nope",
      enabled: true,
      readonly: false
    });
    await store.write(config);

    await checkSources(store, stateStore, "git-missing");
    const state = await stateStore.read();
    const snap = state.sourceSnapshots?.["git-missing"];
    expect(snap?.error).toBeTruthy();
    expect(snap?.hasUpdate).toBe(false);
  });
});

// ─── 维度2：skill ───

describe("checkSkillUpdates", () => {
  test("install 后 sourceHash=contentHash，updatable=false", async () => {
    const { store, stateStore } = await setupHome();
    await installSkill(store, stateStore, "foo");
    const before = (await stateStore.read()).installedSkills.foo!;
    expect(before.sourceHash).toBe(before.contentHash); // add 时即设为 contentHash（源=SSOT）

    const results = await checkSkillUpdates(store, stateStore);
    const r = results.find((x) => x.skillName === "foo");
    expect(r?.updatable).toBe(false);

    const after = (await stateStore.read()).installedSkills.foo!;
    expect(after.sourceHash).toBe(after.contentHash);
    expect(isSkillUpdatable(after)).toBe(false);
  });

  test("源 skill 内容变化后 updatable=true", async () => {
    const { store, stateStore } = await setupHome();
    const { skillDir } = await installSkill(store, stateStore, "foo");
    await checkSkillUpdates(store, stateStore); // baseline: sourceHash=contentHash

    // 改源 skill 内容（SSOT 不变 → 差异）
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\nname: foo\n---\nchanged\n", "utf8");
    const results = await checkSkillUpdates(store, stateStore);
    const r = results.find((x) => x.skillName === "foo");
    expect(r?.updatable).toBe(true);

    const after = (await stateStore.read()).installedSkills.foo!;
    expect(isSkillUpdatable(after)).toBe(true);
  });

  test("sourceId 过滤只查该 source 下的 skill", async () => {
    const { store, stateStore } = await setupHome();
    const a = await installSkill(store, stateStore, "alpha");
    await installSkill(store, stateStore, "beta");

    // 改两个源 skill，但只 check a
    await fs.writeFile(path.join(a.skillDir, "SKILL.md"), "---\nname: alpha\n---\nx\n", "utf8");
    const results = await checkSkillUpdates(store, stateStore, a.source.id);

    expect(results.map((r) => r.skillName)).toEqual(["alpha"]);
    const state = await stateStore.read();
    expect(state.installedSkills.alpha?.sourceHash).toBeDefined();
    // beta 未被本次检测触碰：sourceHash 仍是 add 时的值（= contentHash）
    expect(state.installedSkills.beta?.sourceHash).toBe(state.installedSkills.beta?.contentHash);
  });

  test("跳过 manual-import 与 orphan", async () => {
    const { store, stateStore } = await setupHome();
    await installSkill(store, stateStore, "foo");
    const state = await stateStore.read();
    // 手动塞一个 manual-import record
    state.installedSkills.manual = {
      skillName: "manual",
      displayName: "manual",
      tags: [],
      ssotPath: "/tmp/manual",
      source: { kind: "manual-import", originalPath: "/tmp/x" },
      contentHash: "c1",
      installedAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      enabledAgents: {}
    };
    // 手动塞一个 orphan（source 不在 config）
    state.installedSkills.orphan = {
      skillName: "orphan",
      displayName: "orphan",
      tags: [],
      ssotPath: "/tmp/orphan",
      source: {
        kind: "configured-source",
        sourceId: "ghost",
        sourceType: "local-dir",
        sourcePath: "/tmp/ghost",
        relativePath: "."
      },
      contentHash: "c2",
      installedAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      enabledAgents: {}
    };
    await stateStore.write(state);

    const results = await checkSkillUpdates(store, stateStore);
    const names = results.map((r) => r.skillName);
    expect(names).not.toContain("manual");
    expect(names).not.toContain("orphan");
  });
});
