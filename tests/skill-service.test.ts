import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { ConfigStore } from "../src/core/storage/config-store.js";
import { IndexStore } from "../src/core/storage/index-store.js";
import { StateStore } from "../src/core/storage/state-store.js";
import { refreshIndex } from "../src/core/services/refresh-service.js";
import { addSource, removeSource } from "../src/core/services/source-service.js";
import { skillAdd, skillRebind, skillRemove, skillUpdate } from "../src/core/services/skill-service.js";
import { isBizError } from "../src/core/errors.js";

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function setupHome(): Promise<{ home: string; configStore: ConfigStore; indexStore: IndexStore; stateStore: StateStore }> {
  const home = await tempDir("asm-skill-home-");
  const configStore = new ConfigStore(home);
  const indexStore = new IndexStore(home);
  const stateStore = new StateStore(home);
  const config = await configStore.init();
  config.paths = { home, repos: path.join(home, "repos"), local: path.join(home, "local"), cache: path.join(home, "cache"), skills: path.join(home, "skills") };
  config.agents = {};
  await configStore.write(config);
  return { home, configStore, indexStore, stateStore };
}

async function writeSkill(dir: string, name: string, body = "body"): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\n${body}\n`, "utf8");
}

/** 建含 skill 的 folder source + refresh，返回 source + index。 */
async function addSkillSource(configStore: ConfigStore, indexStore: IndexStore, stateStore: StateStore, skillName: string, body = "body") {
  const dir = await tempDir(`asm-${skillName}-src-`);
  await writeSkill(path.join(dir, skillName), skillName, body);
  const result = await addSource(configStore, stateStore, dir);
  const index = await refreshIndex(await configStore.read(), await stateStore.read());
  await indexStore.write(index);
  return { source: result.source, index };
}

describe("skill-service add (R6)", () => {
  let configStore: ConfigStore;
  let indexStore: IndexStore;
  let stateStore: StateStore;
  beforeEach(async () => ({ configStore, indexStore, stateStore } = await setupHome()));

  test("skillAdd copies a skill into SSOT and writes state record", async () => {
    const { index } = await addSkillSource(configStore, indexStore, stateStore, "foo", "v1");
    const record = await skillAdd(configStore, stateStore, index, "foo");
    expect(record.skillName).toBe("foo");
    expect(record.ssotPath).toContain("skills");
    const state = await stateStore.read();
    expect(state.installedSkills["foo"]).toBeDefined();
    expect(state.installedSkills["foo"].contentHash).toBe(record.contentHash);
    await expect(fs.readFile(path.join(record.ssotPath, "SKILL.md"), "utf8")).resolves.toContain("v1");
  });

  test("skillAdd rejects a skill not in the index", async () => {
    const { index } = await addSkillSource(configStore, indexStore, stateStore, "foo");
    await expect(skillAdd(configStore, stateStore, index, "missing")).rejects.toThrow(/not found in index/i);
  });

  test("skillAdd rejects an already-installed skill", async () => {
    const { index } = await addSkillSource(configStore, indexStore, stateStore, "foo");
    await skillAdd(configStore, stateStore, index, "foo");
    await expect(skillAdd(configStore, stateStore, index, "foo")).rejects.toThrow(/already installed/i);
  });
});

describe("skill-service update (两步分离 R3：显式替换 SSOT)", () => {
  let configStore: ConfigStore;
  let indexStore: IndexStore;
  let stateStore: StateStore;
  beforeEach(async () => ({ configStore, indexStore, stateStore } = await setupHome()));

  test("skillUpdate replaces SSOT content and updates contentHash", async () => {
    const dir = await tempDir("asm-upd-src-");
    const skillDir = path.join(dir, "foo");
    await writeSkill(skillDir, "foo", "v1");
    const result = await addSource(configStore, stateStore, dir);
    let index = await refreshIndex(await configStore.read(), await stateStore.read());
    await skillAdd(configStore, stateStore, index, "foo");
    const beforeHash = (await stateStore.read()).installedSkills["foo"].contentHash;

    // 改 source 内容
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\nname: foo\n---\nv2\n", "utf8");

    const reports = await skillUpdate(configStore, stateStore, "foo");
    expect(reports[0].success).toBe(true);
    expect(reports[0].oldHash).toBe(beforeHash);
    expect(reports[0].newHash).not.toBe(beforeHash);
    await expect(fs.readFile(path.join((await stateStore.read()).installedSkills["foo"].ssotPath, "SKILL.md"), "utf8")).resolves.toContain("v2");
  });

  test("skillUpdate is no-op when source hash matches state", async () => {
    const { index } = await addSkillSource(configStore, indexStore, stateStore, "stable", "v1");
    await skillAdd(configStore, stateStore, index, "stable");
    const beforeHash = (await stateStore.read()).installedSkills["stable"].contentHash;

    const reports = await skillUpdate(configStore, stateStore, "stable");
    expect(reports[0].success).toBe(true);
    expect(reports[0].newHash).toBe(beforeHash);
  });

  test("skillUpdate fails for orphan skill (source removed) with rebind hint", async () => {
    const { index, source } = await addSkillSource(configStore, indexStore, stateStore, "orphan", "v1");
    await skillAdd(configStore, stateStore, index, "orphan");
    await removeSource(configStore, stateStore, source.id); // 默认保留 → 孤儿

    const reports = await skillUpdate(configStore, stateStore, "orphan");
    expect(reports[0].success).toBe(false);
    expect(reports[0].error).toMatch(/orphan|rebind/i);
  });

  test("skillUpdate --all iterates all installed skills", async () => {
    const dir = await tempDir("asm-all-");
    await writeSkill(path.join(dir, "a"), "a", "v1");
    await writeSkill(path.join(dir, "b"), "b", "v1");
    const result = await addSource(configStore, stateStore, dir);
    const index = await refreshIndex(await configStore.read(), await stateStore.read());
    await skillAdd(configStore, stateStore, index, "a");
    await skillAdd(configStore, stateStore, index, "b");

    const reports = await skillUpdate(configStore, stateStore, "--all");
    expect(reports).toHaveLength(2);
    expect(reports.map((r) => r.skillName).sort()).toEqual(["a", "b"]);
  });
});

describe("skill-service rebind + remove (R5/R6)", () => {
  let configStore: ConfigStore;
  let indexStore: IndexStore;
  let stateStore: StateStore;
  beforeEach(async () => ({ configStore, indexStore, stateStore } = await setupHome()));

  test("skillRebind re-associates an orphan skill to a new source, restoring update", async () => {
    const oldDir = await tempDir("asm-rebind-old-");
    await writeSkill(path.join(oldDir, "foo"), "foo", "v1");
    const oldResult = await addSource(configStore, stateStore, oldDir);
    let index = await refreshIndex(await configStore.read(), await stateStore.read());
    await skillAdd(configStore, stateStore, index, "foo");
    await removeSource(configStore, stateStore, oldResult.source.id); // 孤儿

    // 新 source（同名 skill）
    const newDir = await tempDir("asm-rebind-new-");
    await writeSkill(path.join(newDir, "foo"), "foo", "v1");
    const newResult = await addSource(configStore, stateStore, newDir);
    index = await refreshIndex(await configStore.read(), await stateStore.read());

    await skillRebind(configStore, stateStore, index, "foo", newResult.source.id);
    // rebind 后 update 能力恢复
    const reports = await skillUpdate(configStore, stateStore, "foo");
    expect(reports[0].success).toBe(true);
  });

  test("skillRebind rejects when the source does not provide the skill", async () => {
    const fooDir = await tempDir("asm-rb-foo-");
    const barDir = await tempDir("asm-rb-bar-");
    await writeSkill(path.join(fooDir, "foo"), "foo");
    await writeSkill(path.join(barDir, "bar"), "bar");
    const fooResult = await addSource(configStore, stateStore, fooDir);
    const barResult = await addSource(configStore, stateStore, barDir);
    let index = await refreshIndex(await configStore.read(), await stateStore.read());
    await skillAdd(configStore, stateStore, index, "foo");
    index = await refreshIndex(await configStore.read(), await stateStore.read());

    await expect(skillRebind(configStore, stateStore, index, "foo", barResult.source.id)).rejects.toThrow(/does not provide/i);
    // fooResult 仅用于避免 unused 警告
    void fooResult;
  });

  test("skillRemove deletes SSOT + state record", async () => {
    const { index } = await addSkillSource(configStore, indexStore, stateStore, "gone", "v1");
    const record = await skillAdd(configStore, stateStore, index, "gone");
    const ssotPath = record.ssotPath;

    await skillRemove(configStore, stateStore, "gone");
    expect((await stateStore.read()).installedSkills["gone"]).toBeUndefined();
    expect(await fs.access(ssotPath).then(() => true, () => false)).toBe(false);
  });

  test("skillRemove rejects an unknown skill", async () => {
    await expect(skillRemove(configStore, stateStore, "nope")).rejects.toThrow(/not installed/i);
  });
});

/** 捕获 promise 的 rejection，断言是 BizError 且 code 匹配（W1 错误码断言 helper）。 */
async function expectBizCode(p: Promise<unknown>, code: string): Promise<void> {
  const e = await p.catch((x: unknown) => x);
  expect(isBizError(e)).toBe(true);
  expect((e as { code?: unknown }).code).toBe(code);
}

describe("skill-service 业务错误码（W1）", () => {
  let configStore: ConfigStore;
  let indexStore: IndexStore;
  let stateStore: StateStore;
  beforeEach(async () => ({ configStore, indexStore, stateStore } = await setupHome()));

  test("SKILL_ALREADY_INSTALLED: 重复 skillAdd", async () => {
    const { index } = await addSkillSource(configStore, indexStore, stateStore, "foo");
    await skillAdd(configStore, stateStore, index, "foo");
    await expectBizCode(skillAdd(configStore, stateStore, index, "foo"), "SKILL_ALREADY_INSTALLED");
  });

  test("SKILL_NOT_IN_INDEX: skillAdd 索引中不存在的 skill", async () => {
    const { index } = await addSkillSource(configStore, indexStore, stateStore, "foo");
    await expectBizCode(skillAdd(configStore, stateStore, index, "missing"), "SKILL_NOT_IN_INDEX");
  });

  test("SKILL_MULTIPLE_CANDIDATES: 同名 skill 来自多 source", async () => {
    const dirA = await tempDir("asm-mc-a-");
    const dirB = await tempDir("asm-mc-b-");
    await writeSkill(path.join(dirA, "foo"), "foo");
    await writeSkill(path.join(dirB, "foo"), "foo");
    await addSource(configStore, stateStore, dirA);
    await addSource(configStore, stateStore, dirB);
    const index = await refreshIndex(await configStore.read(), await stateStore.read());
    await expectBizCode(skillAdd(configStore, stateStore, index, "foo"), "SKILL_MULTIPLE_CANDIDATES");
  });

  test("SOURCE_NOT_PROVIDE_SKILL: skillRebind 到不提供该 skill 的 source", async () => {
    const fooDir = await tempDir("asm-rbc-foo-");
    const barDir = await tempDir("asm-rbc-bar-");
    await writeSkill(path.join(fooDir, "foo"), "foo");
    await writeSkill(path.join(barDir, "bar"), "bar");
    const fooResult = await addSource(configStore, stateStore, fooDir);
    const barResult = await addSource(configStore, stateStore, barDir);
    const index = await refreshIndex(await configStore.read(), await stateStore.read());
    await skillAdd(configStore, stateStore, index, "foo");
    await expectBizCode(skillRebind(configStore, stateStore, index, "foo", barResult.source.id), "SOURCE_NOT_PROVIDE_SKILL");
    void fooResult;
  });

  test("SKILL_NOT_INSTALLED: skillRemove / skillRebind 未安装 skill", async () => {
    const { index } = await addSkillSource(configStore, indexStore, stateStore, "foo");
    await expectBizCode(skillRemove(configStore, stateStore, "nope"), "SKILL_NOT_INSTALLED");
    await expectBizCode(skillRebind(configStore, stateStore, index, "nope", "any"), "SKILL_NOT_INSTALLED");
  });

  test("SOURCE_ID_UNKNOWN: skillAdd / skillRebind 未知 source id", async () => {
    const { index } = await addSkillSource(configStore, indexStore, stateStore, "foo");
    await expectBizCode(skillAdd(configStore, stateStore, index, "foo", { source: "nope" }), "SOURCE_ID_UNKNOWN");
    await skillAdd(configStore, stateStore, index, "foo");
    await expectBizCode(skillRebind(configStore, stateStore, index, "foo", "nope"), "SOURCE_ID_UNKNOWN");
  });
});
