/**
 * skills.sh 安装 plan builder + apply 测试（implement.md 阶段 2 + 阶段 4）。
 *
 * plan builder：纯只读，覆盖 create/reuse/disabled/ambiguous/同名/非法 source/unsafe skillId，
 * 且证明不 clone、不 refresh、不改 config/state。
 * apply：用临时 ASM_HOME + 注入的 createRepoSource（模拟 clone）+ 本地 SKILL.md，
 * 覆盖首次创建、同仓库复用、URL 变体、disabled/ambiguous/missing/ambiguous candidate、
 * 全阶段故障注入（断言 config/clone/SSOT/state 最终状态）、reuse 保护、final index warning、
 * enabledAgents 为空、rollback token 身份不一致拒绝删除。绝不访问真实 GitHub。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ConfigStore } from "../src/core/storage/config-store.js";
import { IndexStore } from "../src/core/storage/index-store.js";
import { StateStore } from "../src/core/storage/state-store.js";
import { createDefaultConfig } from "../src/core/storage/config-store.js";
import { dedupeId, slugify } from "../src/core/services/source-service.js";
import { resolveConfiguredPath } from "../src/utils/path.js";
import { pathExists } from "../src/utils/fs.js";
import {
  applySkillsShInstallPlan,
  buildSkillsShInstallPlan,
  type SkillsShInstallStores,
} from "../src/core/services/skills-sh-install-service.js";
import type { SkillsShSkillRef } from "../src/core/services/skills-sh-service.js";
import type { SourceConfig } from "../src/core/models/config.js";
import { isBizError } from "../src/core/errors.js";
import { createEmptyState } from "../src/core/models/state.js";

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function setupHome(): Promise<{ home: string; configStore: ConfigStore; indexStore: IndexStore; stateStore: StateStore }> {
  const home = await tempDir("asm-sh-home-");
  const configStore = new ConfigStore(home);
  const indexStore = new IndexStore(home);
  const stateStore = new StateStore(home);
  const config = await configStore.init();
  config.paths = { home, repos: path.join(home, "repos"), local: path.join(home, "local"), cache: path.join(home, "cache"), skills: path.join(home, "skills") };
  config.agents = {};
  config.sources = [];
  await configStore.write(config);
  return { home, configStore, indexStore, stateStore };
}

function makeRef(overrides: Partial<SkillsShSkillRef> = {}): SkillsShSkillRef {
  return {
    provider: "skills.sh",
    id: "api-1",
    skillId: "foo",
    name: "Foo",
    installs: 7,
    source: "owner/repo",
    repository: { owner: "owner", repo: "repo", key: "github:owner/repo", cloneUrl: "https://github.com/owner/repo.git" },
    ...overrides,
  };
}

/** 把一个 skill 写进 repo 目录（dir 缺省 = skillId），用于 seedRepoSource / fakeClone。 */
async function writeSkillInto(repoRoot: string, skillId: string, body = "v1", dir?: string): Promise<void> {
  const skillDir = dir ? path.join(repoRoot, dir) : path.join(repoRoot, skillId);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: ${skillId}\n---\n${body}\n`, "utf8");
}

interface SeedOptions {
  enabled?: boolean;
  branch?: string;
  skills?: Array<{ skillId: string; body?: string; dir?: string }>;
}

/** 在 repos/<id> 下创建一个 git-repo source（含给定 skills）并写 config。可手动调，也可作 fakeClone。 */
async function seedRepoSource(configStore: ConfigStore, url: string, options: SeedOptions = {}): Promise<SourceConfig> {
  const config = await configStore.read();
  const id = dedupeId(config, slugify(url));
  const reposDir = resolveConfiguredPath(config.paths.repos);
  const dest = path.join(reposDir, id);
  await fs.mkdir(dest, { recursive: true });
  for (const { skillId, body, dir } of options.skills ?? []) {
    await writeSkillInto(dest, skillId, body, dir);
  }
  const source: SourceConfig = { id, name: id, type: "git-repo", path: dest, enabled: options.enabled ?? true, url, branch: options.branch };
  config.sources.push(source);
  await configStore.write(config);
  return source;
}

/** fake clone：闭包预设 repo 内含哪些 skills；调用时在 repos/<id> 建目录 + 写 config。 */
function makeFakeClone(skills: Array<{ skillId: string; body?: string; dir?: string }>): (configStore: ConfigStore, cloneUrl: string) => Promise<SourceConfig> {
  return (configStore, cloneUrl) => seedRepoSource(configStore, cloneUrl, { skills });
}

/** fake clone 但抛错（模拟 clone 失败）。 */
function makeFailingClone(message: string): (configStore: ConfigStore, cloneUrl: string) => Promise<SourceConfig> {
  return async () => Promise.reject(new Error(message));
}

async function expectBizCode(p: Promise<unknown>, code: string): Promise<unknown> {
  const e = await p.catch((x: unknown) => x);
  expect(isBizError(e)).toBe(true);
  expect((e as { code?: unknown }).code).toBe(code);
  return e;
}

// === buildSkillsShInstallPlan（只读，阶段 2）===
describe("buildSkillsShInstallPlan (只读)", () => {
  test("create plan when no matching source", () => {
    const config = createDefaultConfig();
    config.sources = [];
    const plan = buildSkillsShInstallPlan(config, createEmptyState(), makeRef());
    expect(plan.hasConflict).toBe(false);
    expect(plan.source).toEqual({ action: "create", cloneUrl: "https://github.com/owner/repo.git" });
  });

  test("reuse plan when exactly one enabled git-repo matches canonical key", () => {
    const config = createDefaultConfig();
    config.sources = [{ id: "repo", name: "repo", type: "git-repo", path: "/p", enabled: true, url: "git@github.com:Owner/Repo.git" }];
    const plan = buildSkillsShInstallPlan(config, createEmptyState(), makeRef());
    expect(plan.hasConflict).toBe(false);
    expect(plan.source).toEqual({ action: "reuse", sourceId: "repo" });
  });

  test("disabled conflict when matching source is disabled", () => {
    const config = createDefaultConfig();
    config.sources = [{ id: "repo", name: "repo", type: "git-repo", path: "/p", enabled: false, url: "https://github.com/owner/repo" }];
    const plan = buildSkillsShInstallPlan(config, createEmptyState(), makeRef());
    expect(plan.hasConflict).toBe(true);
    expect(plan.conflictCode).toBe("SKILLS_SH_SOURCE_DISABLED");
    expect(plan.conflictParams).toMatchObject({ sourceId: "repo" });
    expect(plan.source.action).toBe("create");
  });

  test("ambiguous conflict when multiple sources match canonical key", () => {
    const config = createDefaultConfig();
    config.sources = [
      { id: "a", name: "a", type: "git-repo", path: "/p1", enabled: true, url: "https://github.com/owner/repo.git" },
      { id: "b", name: "b", type: "git-repo", path: "/p2", enabled: true, url: "git@github.com:owner/repo" },
    ];
    const plan = buildSkillsShInstallPlan(config, createEmptyState(), makeRef());
    expect(plan.hasConflict).toBe(true);
    expect(plan.conflictCode).toBe("SKILLS_SH_SOURCE_AMBIGUOUS");
  });

  test("SKILL_ALREADY_INSTALLED conflict when skillId already in state", () => {
    const config = createDefaultConfig();
    config.sources = [];
    const state = createEmptyState();
    state.installedSkills["foo"] = {
      skillName: "foo", displayName: "foo", tags: [], ssotPath: "/s/foo",
      source: { kind: "manual-import" }, contentHash: "x", installedAt: "t", updatedAt: "t", enabledAgents: {},
    };
    const plan = buildSkillsShInstallPlan(config, state, makeRef());
    expect(plan.hasConflict).toBe(true);
    expect(plan.conflictCode).toBe("SKILL_ALREADY_INSTALLED");
  });

  test("INVALID_SKILL_NAME conflict for unsafe skillId", () => {
    const config = createDefaultConfig();
    config.sources = [];
    const ref = makeRef({ skillId: "../escape", source: "owner/repo" });
    const plan = buildSkillsShInstallPlan(config, createEmptyState(), ref);
    expect(plan.hasConflict).toBe(true);
    expect(plan.conflictCode).toBe("INVALID_SKILL_NAME");
  });

  test("INVALID_GITHUB_SOURCE conflict when ref.source is not owner/repo", () => {
    const config = createDefaultConfig();
    config.sources = [];
    const ref = makeRef({ source: "https://gitlab.com/a/b" });
    const plan = buildSkillsShInstallPlan(config, createEmptyState(), ref);
    expect(plan.hasConflict).toBe(true);
    expect(plan.conflictCode).toBe("SKILLS_SH_INVALID_GITHUB_SOURCE");
  });

  test("INVALID_GITHUB_SOURCE conflict when repository.key disagrees with source", () => {
    const config = createDefaultConfig();
    config.sources = [];
    // source 解析为 owner/repo，但 repository 声称别的 key → 自洽失败。
    const ref = makeRef();
    ref.repository = { owner: "other", repo: "x", key: "github:other/x", cloneUrl: "https://github.com/other/x.git" };
    const plan = buildSkillsShInstallPlan(config, createEmptyState(), ref);
    expect(plan.hasConflict).toBe(true);
    expect(plan.conflictCode).toBe("SKILLS_SH_INVALID_GITHUB_SOURCE");
  });

  test("does NOT mutate config or state (pure)", () => {
    const config = createDefaultConfig();
    config.sources = [{ id: "repo", name: "repo", type: "git-repo", path: "/p", enabled: true, url: "https://github.com/owner/repo.git" }];
    const state = createEmptyState();
    const configSnap = JSON.stringify(config);
    const stateSnap = JSON.stringify(state);
    buildSkillsShInstallPlan(config, state, makeRef());
    expect(JSON.stringify(config)).toBe(configSnap);
    expect(JSON.stringify(state)).toBe(stateSnap);
  });
});

// === applySkillsShInstallPlan（阶段 4）===
describe("applySkillsShInstallPlan success", () => {
  let stores: SkillsShInstallStores;
  let home: string;
  beforeEach(async () => {
    const s = await setupHome();
    home = s.home;
    stores = { configStore: s.configStore, indexStore: s.indexStore, stateStore: s.stateStore };
  });

  test("first install creates source + SSOT skill, enabledAgents empty", async () => {
    const ref = makeRef({ skillId: "foo" });
    const plan = buildSkillsShInstallPlan(await stores.configStore.read(), await stores.stateStore.read(), ref);
    const result = await applySkillsShInstallPlan(stores, plan, { createRepoSource: makeFakeClone([{ skillId: "foo" }]) });

    expect(result.sourceAction).toBe("created");
    expect(result.record.skillName).toBe("foo");
    expect(result.record.enabledAgents).toEqual({});
    expect(result.indexUpdated).toBe(true);
    // source 写入 config；clone 目录存在；SSOT 存在；state 有 foo。
    const config = await stores.configStore.read();
    expect(config.sources.some((s) => s.id === result.source.id && s.url === ref.repository.cloneUrl)).toBe(true);
    expect(await pathExists(result.source.path)).toBe(true);
    expect(await pathExists(result.record.ssotPath)).toBe(true);
    expect((await stores.stateStore.read()).installedSkills["foo"]).toBeDefined();
  });

  test("second skill in same repo reuses source (no new source, no re-clone)", async () => {
    const fooRef = makeRef({ skillId: "foo" });
    const barRef = makeRef({ skillId: "bar" });
    // 第一次：create，repo 同时含 foo+bar（模拟 clone 下来的完整仓库）。
    const createClone = makeFakeClone([{ skillId: "foo" }, { skillId: "bar" }]);
    const plan1 = buildSkillsShInstallPlan(await stores.configStore.read(), await stores.stateStore.read(), fooRef);
    const r1 = await applySkillsShInstallPlan(stores, plan1, { createRepoSource: createClone });
    expect(r1.sourceAction).toBe("created");
    const firstSourceId = r1.source.id;
    const sourceCountAfterFirst = (await stores.configStore.read()).sources.length;

    // 第二次：reuse（plan 应为 reuse），createRepoSource 不应被调用。
    let cloneCalled = false;
    const plan2 = buildSkillsShInstallPlan(await stores.configStore.read(), await stores.stateStore.read(), barRef);
    expect(plan2.source).toEqual({ action: "reuse", sourceId: firstSourceId });
    const r2 = await applySkillsShInstallPlan(stores, plan2, {
      createRepoSource: async () => {
        cloneCalled = true;
        throw new Error("should not clone");
      },
    });
    expect(r2.sourceAction).toBe("reused");
    expect(cloneCalled).toBe(false);
    expect((await stores.configStore.read()).sources.length).toBe(sourceCountAfterFirst);
    // 两个 skill 各自 SSOT，共享 sourceId。
    const state = await stores.stateStore.read();
    expect(state.installedSkills["foo"]).toBeDefined();
    expect(state.installedSkills["bar"]).toBeDefined();
    expect(state.installedSkills["foo"].source).toMatchObject({ sourceId: firstSourceId });
    expect(state.installedSkills["bar"].source).toMatchObject({ sourceId: firstSourceId });
  });

  test("URL variant canonical reuse (SSH url config, HTTPS clone)", async () => {
    // 预置一个 SSH url 的 git-repo source（含 foo）。
    await seedRepoSource(stores.configStore, "git@github.com:owner/repo.git", { skills: [{ skillId: "foo" }] });
    const ref = makeRef({ skillId: "foo" });
    const plan = buildSkillsShInstallPlan(await stores.configStore.read(), await stores.stateStore.read(), ref);
    expect(plan.source.action).toBe("reuse");
    const result = await applySkillsShInstallPlan(stores, plan, {
      createRepoSource: makeFailingClone("must not clone"),
    });
    expect(result.sourceAction).toBe("reused");
    expect(result.record.skillName).toBe("foo");
  });
});

describe("applySkillsShInstallPlan conflicts (no side effects)", () => {
  let stores: SkillsShInstallStores;
  beforeEach(async () => {
    const s = await setupHome();
    stores = { configStore: s.configStore, indexStore: s.indexStore, stateStore: s.stateStore };
  });

  test("disabled source -> conflict, no clone, config unchanged", async () => {
    await seedRepoSource(stores.configStore, "https://github.com/owner/repo.git", { enabled: false });
    const ref = makeRef();
    const plan = buildSkillsShInstallPlan(await stores.configStore.read(), await stores.stateStore.read(), ref);
    await expectBizCode(applySkillsShInstallPlan(stores, plan, { createRepoSource: makeFailingClone("no") }), "SKILLS_SH_SOURCE_DISABLED");
    expect((await stores.configStore.read()).sources).toHaveLength(1);
    expect((await stores.stateStore.read()).installedSkills).toEqual({});
  });

  test("ambiguous sources -> conflict, no clone", async () => {
    await seedRepoSource(stores.configStore, "https://github.com/owner/repo.git");
    await seedRepoSource(stores.configStore, "git@github.com:owner/repo.git");
    const ref = makeRef();
    const plan = buildSkillsShInstallPlan(await stores.configStore.read(), await stores.stateStore.read(), ref);
    await expectBizCode(applySkillsShInstallPlan(stores, plan, { createRepoSource: makeFailingClone("no") }), "SKILLS_SH_SOURCE_AMBIGUOUS");
    expect((await stores.configStore.read()).sources.length).toBe(2);
  });
});

describe("applySkillsShInstallPlan new-source rollback (故障注入)", () => {
  let stores: SkillsShInstallStores;
  beforeEach(async () => {
    const s = await setupHome();
    stores = { configStore: s.configStore, indexStore: s.indexStore, stateStore: s.stateStore };
  });

  test("clone failure -> no config, no leftover clone", async () => {
    const ref = makeRef();
    const plan = buildSkillsShInstallPlan(await stores.configStore.read(), await stores.stateStore.read(), ref);
    await expect(applySkillsShInstallPlan(stores, plan, { createRepoSource: makeFailingClone("clone boom") })).rejects.toThrow(/clone boom/);
    expect((await stores.configStore.read()).sources).toEqual([]);
    expect((await stores.stateStore.read()).installedSkills).toEqual({});
  });

  test("candidate missing -> source + clone rolled back, state/index untouched", async () => {
    const ref = makeRef({ skillId: "foo" });
    const plan = buildSkillsShInstallPlan(await stores.configStore.read(), await stores.stateStore.read(), ref);
    const e = await expectBizCode(
      applySkillsShInstallPlan(stores, plan, { createRepoSource: makeFakeClone([{ skillId: "other" }]) }),
      "SKILLS_SH_CANDIDATE_NOT_FOUND",
    );
    void e;
    const config = await stores.configStore.read();
    expect(config.sources).toEqual([]);
    expect((await stores.stateStore.read()).installedSkills).toEqual({});
    const index = await stores.indexStore.read();
    expect(index.skills).toEqual({});
  });

  test("candidate ambiguous -> rolled back", async () => {
    const ref = makeRef({ skillId: "foo" });
    const plan = buildSkillsShInstallPlan(await stores.configStore.read(), await stores.stateStore.read(), ref);
    await expectBizCode(
      applySkillsShInstallPlan(stores, plan, {
        createRepoSource: makeFakeClone([{ skillId: "foo", dir: "a" }, { skillId: "foo", dir: "b" }]),
      }),
      "SKILLS_SH_CANDIDATE_AMBIGUOUS",
    );
    expect((await stores.configStore.read()).sources).toEqual([]);
  });

  test("SSOT target pre-exists (no state) -> SSOT_TARGET_EXISTS + rollback new source", async () => {
    const config = await stores.configStore.read();
    const preSsot = path.join(config.paths.skills, "foo");
    await fs.mkdir(preSsot, { recursive: true });
    await fs.writeFile(path.join(preSsot, "MARKER"), "keep", "utf8");

    const ref = makeRef({ skillId: "foo" });
    const plan = buildSkillsShInstallPlan(await stores.configStore.read(), await stores.stateStore.read(), ref);
    await expectBizCode(applySkillsShInstallPlan(stores, plan, { createRepoSource: makeFakeClone([{ skillId: "foo" }]) }), "SSOT_TARGET_EXISTS");
    // 新 source 被回滚；预存 SSOT 内容保留。
    expect((await stores.configStore.read()).sources).toEqual([]);
    expect(await fs.readFile(path.join(preSsot, "MARKER"), "utf8")).toBe("keep");
  });

  test("state write failure -> SSOT cleaned + new source rolled back", async () => {
    const ref = makeRef({ skillId: "foo" });
    const plan = buildSkillsShInstallPlan(await stores.configStore.read(), await stores.stateStore.read(), ref);
    const writeSpy = vi.spyOn(stores.stateStore, "write").mockRejectedValueOnce(new Error("state boom"));
    await expect(applySkillsShInstallPlan(stores, plan, { createRepoSource: makeFakeClone([{ skillId: "foo" }]) })).rejects.toThrow(/state boom/);
    writeSpy.mockRestore();
    // SSOT target 被清理（skillAddCandidate 事务），新 source 被 apply rollback。
    const config = await stores.configStore.read();
    expect(config.sources).toEqual([]);
    expect((await stores.stateStore.read()).installedSkills).toEqual({});
    const ssotPath = path.join(config.paths.skills, "foo");
    expect(await pathExists(ssotPath)).toBe(false);
  });
});

describe("applySkillsShInstallPlan reuse-source protection", () => {
  let stores: SkillsShInstallStores;
  beforeEach(async () => {
    const s = await setupHome();
    stores = { configStore: s.configStore, indexStore: s.indexStore, stateStore: s.stateStore };
  });

  test("reuse source candidate missing -> NOT_FOUND, existing source + clone untouched", async () => {
    const existing = await seedRepoSource(stores.configStore, "https://github.com/owner/repo.git", { skills: [{ skillId: "bar" }] });
    const ref = makeRef({ skillId: "foo" }); // repo 里没有 foo
    const plan = buildSkillsShInstallPlan(await stores.configStore.read(), await stores.stateStore.read(), ref);
    expect(plan.source.action).toBe("reuse");
    await expectBizCode(applySkillsShInstallPlan(stores, plan, { createRepoSource: makeFailingClone("no") }), "SKILLS_SH_CANDIDATE_NOT_FOUND");
    // reuse source 完全保留。
    const config = await stores.configStore.read();
    expect(config.sources.some((s) => s.id === existing.id)).toBe(true);
    expect(await pathExists(existing.path)).toBe(true);
    // bar 之前也没安装，但 source 仍在。
    expect((await stores.stateStore.read()).installedSkills).toEqual({});
  });

  test("reuse source SSOT target pre-exists -> conflict, existing source untouched", async () => {
    const existing = await seedRepoSource(stores.configStore, "https://github.com/owner/repo.git", { skills: [{ skillId: "foo" }] });
    const config = await stores.configStore.read();
    const preSsot = path.join(config.paths.skills, "foo");
    await fs.mkdir(preSsot, { recursive: true });
    const ref = makeRef({ skillId: "foo" });
    const plan = buildSkillsShInstallPlan(await stores.configStore.read(), await stores.stateStore.read(), ref);
    await expectBizCode(applySkillsShInstallPlan(stores, plan, { createRepoSource: makeFailingClone("no") }), "SSOT_TARGET_EXISTS");
    const after = await stores.configStore.read();
    expect(after.sources.some((s) => s.id === existing.id)).toBe(true);
    expect(await pathExists(existing.path)).toBe(true);
  });
});

describe("applySkillsShInstallPlan final index warning", () => {
  let stores: SkillsShInstallStores;
  beforeEach(async () => {
    const s = await setupHome();
    stores = { configStore: s.configStore, indexStore: s.indexStore, stateStore: s.stateStore };
  });

  test("IndexStore.write fails -> install committed, indexUpdated=false with warning", async () => {
    const ref = makeRef({ skillId: "foo" });
    const plan = buildSkillsShInstallPlan(await stores.configStore.read(), await stores.stateStore.read(), ref);
    const writeSpy = vi.spyOn(stores.indexStore, "write").mockRejectedValueOnce(new Error("index boom"));
    const result = await applySkillsShInstallPlan(stores, plan, { createRepoSource: makeFakeClone([{ skillId: "foo" }]) });
    writeSpy.mockRestore();
    expect(result.indexUpdated).toBe(false);
    expect(result.warnings.some((w) => /index refresh failed/i.test(w))).toBe(true);
    // source / SSOT / state 已提交，保留。
    expect((await stores.configStore.read()).sources).toHaveLength(1);
    expect((await stores.stateStore.read()).installedSkills["foo"]).toBeDefined();
    expect(await pathExists(result.record.ssotPath)).toBe(true);
    // 再次 refresh + 写能恢复 index。
    const { refreshIndex } = await import("../src/core/services/refresh-service.js");
    const config = await stores.configStore.read();
    const state = await stores.stateStore.read();
    const refreshed = await refreshIndex(config, state);
    expect(refreshed.skills["foo"]).toBeDefined();
  });
});

describe("applySkillsShInstallPlan rollback token identity", () => {
  let stores: SkillsShInstallStores;
  beforeEach(async () => {
    const s = await setupHome();
    stores = { configStore: s.configStore, indexStore: s.indexStore, stateStore: s.stateStore };
  });

  test("identity mismatch (concurrent url change) -> rollback refuses to delete, source kept", async () => {
    // fake clone：正常创建 source（不含 foo → candidate missing 触发 rollback），返回前篡改 config url。
    const tamperingClone = async (configStore: ConfigStore, cloneUrl: string): Promise<SourceConfig> => {
      const source = await seedRepoSource(configStore, cloneUrl, { skills: [] }); // 不含 foo
      // 模拟并发：把 config 中该 source 的 url 改成别的仓库。
      const config = await configStore.read();
      const tampered = config.sources.find((s) => s.id === source.id);
      if (tampered) {
        tampered.url = "https://github.com/other/repo.git";
        await configStore.write(config);
      }
      return source; // 返回的 source.url 仍是原始 cloneUrl（token 记录原始）
    };
    const ref = makeRef({ skillId: "foo" });
    const plan = buildSkillsShInstallPlan(await stores.configStore.read(), await stores.stateStore.read(), ref);
    await expectBizCode(applySkillsShInstallPlan(stores, plan, { createRepoSource: tamperingClone }), "SKILLS_SH_CANDIDATE_NOT_FOUND");
    // rollback 身份校验失败（token.url !== config.url）→ 拒绝删除：source 与 clone 仍在。
    const config = await stores.configStore.read();
    expect(config.sources).toHaveLength(1);
    expect(await pathExists(config.sources[0].path)).toBe(true);
  });
});
