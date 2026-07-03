import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { ConfigStore } from "../src/core/storage/config-store.js";
import { StateStore } from "../src/core/storage/state-store.js";
import { addSource, listSources, removeSource, setSourceEnabled, sourceUpdate } from "../src/core/services/source-service.js";
import { skillAdd } from "../src/core/services/skill-service.js";
import { refreshIndex } from "../src/core/services/refresh-service.js";

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function setupHome(): Promise<{ home: string; store: ConfigStore; stateStore: StateStore }> {
  const home = await tempDir("asm-src-home-");
  const store = new ConfigStore(home);
  const stateStore = new StateStore(home);
  const config = await store.init();
  config.paths = { home, repos: path.join(home, "repos"), local: path.join(home, "local"), cache: path.join(home, "cache"), skills: path.join(home, "skills") };
  config.agents = {};
  await store.write(config);
  return { home, store, stateStore };
}

async function writeSkill(dir: string, name: string, body = "body"): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\n${body}\n`, "utf8");
}

/** 建一个含 skill 的本地 folder source，refresh 并 skillAdd 进 SSOT（建 state record）。 */
async function installSkill(store: ConfigStore, stateStore: StateStore, skillName: string, body = "body") {
  const dir = await tempDir(`asm-${skillName}-`);
  const skillDir = path.join(dir, skillName);
  await writeSkill(skillDir, skillName, body);
  const result = await addSource(store, stateStore, dir);
  const index = await refreshIndex(await store.read(), await stateStore.read());
  await skillAdd(store, stateStore, index, skillName);
  return { source: result.source, skillDir };
}

describe("source-service add (三合一 R2)", () => {
  let store: ConfigStore;
  let stateStore: StateStore;
  beforeEach(async () => ({ store, stateStore } = await setupHome()));

  test("infers folder (local-dir) for a multi-skill directory", async () => {
    const dir = await tempDir("asm-folder-");
    await writeSkill(path.join(dir, "foo"), "foo");
    await writeSkill(path.join(dir, "bar"), "bar");
    const result = await addSource(store, stateStore, dir);
    expect(result.source.type).toBe("local-dir");
    expect(result.source.enabled).toBe(true);
  });

  test("infers skill (single-skill) for a dir containing SKILL.md", async () => {
    const dir = await tempDir("asm-skill-");
    await writeSkill(dir, "solo");
    const result = await addSource(store, stateStore, dir);
    expect(result.source.type).toBe("single-skill");
  });

  test("--type folder forces local-dir even with SKILL.md", async () => {
    const dir = await tempDir("asm-force-");
    await writeSkill(dir, "solo");
    const result = await addSource(store, stateStore, dir, { type: "folder" });
    expect(result.source.type).toBe("local-dir");
  });

  test("rejects a non-existent path", async () => {
    await expect(addSource(store, stateStore, path.join(os.tmpdir(), "asm-nope-" + Date.now()))).rejects.toThrow(/exist/i);
  });

  test("rejects a duplicate path", async () => {
    const dir = await tempDir("asm-dup-");
    await writeSkill(path.join(dir, "foo"), "foo");
    await addSource(store, stateStore, dir);
    await expect(addSource(store, stateStore, dir)).rejects.toThrow(/already registered/i);
  });

  test("honors a custom id and rejects an existing custom id", async () => {
    const dirA = await tempDir("asm-id-a-");
    const dirB = await tempDir("asm-id-b-");
    await writeSkill(path.join(dirA, "a"), "a");
    await writeSkill(path.join(dirB, "b"), "b");
    const a = await addSource(store, stateStore, dirA, { id: "my-id" });
    expect(a.source.id).toBe("my-id");
    await expect(addSource(store, stateStore, dirB, { id: "my-id" })).rejects.toThrow(/already exists/i);
  });

  test("listSources returns configured sources", async () => {
    const dir = await tempDir("asm-list-");
    await writeSkill(path.join(dir, "alpha"), "alpha");
    await addSource(store, stateStore, dir);
    const sources = listSources(await store.read());
    expect(sources).toHaveLength(1);
    expect(sources[0].type).toBe("local-dir");
  });
});

describe("source-service update (两步分离 R3：只报告，不替换 SSOT)", () => {
  let store: ConfigStore;
  let stateStore: StateStore;
  beforeEach(async () => ({ store, stateStore } = await setupHome()));

  test("reports updatable skills after source content changes (SSOT untouched)", async () => {
    const { source, skillDir } = await installSkill(store, stateStore, "my-skill", "v1");
    const beforeHash = (await stateStore.read()).installedSkills["my-skill"].contentHash;

    await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\nname: my-skill\n---\nv2\n", "utf8");

    const reports = await sourceUpdate(store, stateStore, source.id);
    expect(reports).toHaveLength(1);
    expect(reports[0].success).toBe(true);
    expect(reports[0].updatableSkills).toContain("my-skill");
    // SSOT 未被替换（两步分离）：contentHash 不变
    expect((await stateStore.read()).installedSkills["my-skill"].contentHash).toBe(beforeHash);
  });

  test("reports up-to-date when source hash matches state", async () => {
    const { source } = await installSkill(store, stateStore, "stable", "v1");
    const reports = await sourceUpdate(store, stateStore, source.id);
    expect(reports[0].upToDateSkills).toContain("stable");
    expect(reports[0].updatableSkills).toEqual([]);
  });

  test("rejects an unknown source id", async () => {
    await expect(sourceUpdate(store, stateStore, "nope")).rejects.toThrow(/unknown source id/i);
  });
});

describe("source-service enable / disable / remove (R4)", () => {
  let store: ConfigStore;
  let stateStore: StateStore;
  beforeEach(async () => ({ store, stateStore } = await setupHome()));

  test("setSourceEnabled toggles and persists", async () => {
    const dir = await tempDir("asm-toggle-");
    await writeSkill(path.join(dir, "x"), "x");
    const result = await addSource(store, stateStore, dir);
    await setSourceEnabled(store, result.source.id, false);
    expect((await store.read()).sources.find((s) => s.id === result.source.id)?.enabled).toBe(false);
    await setSourceEnabled(store, result.source.id, true);
    expect((await store.read()).sources.find((s) => s.id === result.source.id)?.enabled).toBe(true);
  });

  test("setSourceEnabled rejects unknown id", async () => {
    await expect(setSourceEnabled(store, "nope", true)).rejects.toThrow(/unknown source id/i);
  });

  test("removeSource (default) keeps SSOT skills as orphans", async () => {
    const { source } = await installSkill(store, stateStore, "orphan-me", "v1");
    expect((await stateStore.read()).installedSkills["orphan-me"]).toBeDefined();

    const res = await removeSource(store, stateStore, source.id);
    expect((await store.read()).sources.some((s) => s.id === source.id)).toBe(false);
    // 默认保留：state record 仍在（孤儿），SSOT 内容仍在
    expect((await stateStore.read()).installedSkills["orphan-me"]).toBeDefined();
    expect(res.orphaned).toContain("orphan-me");
    expect(res.purged).toEqual([]);
  });

  test("removeSource --purge cascade-deletes SSOT skill + state record", async () => {
    const { source } = await installSkill(store, stateStore, "purge-me", "v1");
    const ssotPath = (await stateStore.read()).installedSkills["purge-me"].ssotPath;

    const res = await removeSource(store, stateStore, source.id, { purge: true });
    expect((await stateStore.read()).installedSkills["purge-me"]).toBeUndefined();
    expect(await fs.access(ssotPath).then(() => true, () => false)).toBe(false);
    expect(res.purged).toContain("purge-me");
  });

  test("removeSource rejects unknown id", async () => {
    await expect(removeSource(store, stateStore, "nope")).rejects.toThrow(/unknown source id/i);
  });
});
