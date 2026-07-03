import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import type { AppConfig } from "../src/core/models/config.js";
import { ConfigStore } from "../src/core/storage/config-store.js";
import { IndexStore } from "../src/core/storage/index-store.js";
import { StateStore } from "../src/core/storage/state-store.js";
import { refreshIndex } from "../src/core/services/refresh-service.js";
import { addSource } from "../src/core/services/source-service.js";
import { addSingleSkill, importSkillToSsot, preferSkill } from "../src/core/services/skill-service.js";

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function setupHome(): Promise<{ home: string; store: ConfigStore; config: AppConfig }> {
  const home = await tempDir("asm-skill-home-");
  const store = new ConfigStore(home);
  const config = await store.init();
  config.paths = {
    home,
    repos: path.join(home, "repos"),
    local: path.join(home, "local"),
    cache: path.join(home, "cache"),
    skills: path.join(home, "skills")
  };
  config.sources = [];
  config.agents = {};
  await store.write(config);
  return { home, store, config };
}

async function writeSkill(dir: string, name: string, body = "body"): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\n${body}\n`, "utf8");
}

describe("skill-service add", () => {
  let store: ConfigStore;

  beforeEach(async () => {
    ({ store } = await setupHome());
  });

  test("addSingleSkill registers a single-skill source", async () => {
    const skillDir = await tempDir("asm-skill-add-");
    await writeSkill(skillDir, "foo");

    const source = await addSingleSkill(store, skillDir);
    expect(source.type).toBe("single-skill");
    expect((await store.read()).sources.some((entry) => entry.id === source.id)).toBe(true);
  });

  test("addSingleSkill rejects a directory without SKILL.md", async () => {
    const dir = await tempDir("asm-skill-noskill-");
    await expect(addSingleSkill(store, dir)).rejects.toThrow(/SKILL.md/);
  });

  test("addSingleSkill rejects a duplicate path", async () => {
    const skillDir = await tempDir("asm-skill-dup-");
    await writeSkill(skillDir, "foo");
    await addSingleSkill(store, skillDir);
    await expect(addSingleSkill(store, skillDir)).rejects.toThrow(/already registered/i);
  });
});


describe("skill-service import to SSOT", () => {
  let store: ConfigStore;
  let stateStore: StateStore;

  beforeEach(async () => {
    const setup = await setupHome();
    store = setup.store;
    stateStore = new StateStore(setup.home);
  });

  test("rejects path traversal skill names", async () => {
    const skillDir = await tempDir("asm-skill-unsafe-");
    await writeSkill(skillDir, "../escape");
    await expect(importSkillToSsot(store, stateStore, skillDir)).rejects.toThrow(/Invalid skill name/);
  });
});

describe("skill-service prefer", () => {
  let store: ConfigStore;
  let indexStore: IndexStore;

  beforeEach(async () => {
    const setup = await setupHome();
    store = setup.store;
    indexStore = new IndexStore(store.home);
  });

  async function refresh() {
    const index = await refreshIndex(await store.read());
    await indexStore.write(index);
    return index;
  }

  test("preferSkill writes override and resolves conflict to managed", async () => {
    const dirA = path.join(await tempDir("asm-pref-a-"), "shared");
    const dirB = path.join(await tempDir("asm-pref-b-"), "shared");
    await writeSkill(dirA, "shared", "a");
    await writeSkill(dirB, "shared", "b");
    const a = await addSource(store, dirA);
    await addSource(store, dirB);

    expect((await refresh()).skills.shared.status).toBe("conflict");

    await preferSkill(store, indexStore, "shared", a.id);
    expect((await store.read()).skillOverrides.shared?.preferredSourceId).toBe(a.id);

    const after = await refresh();
    expect(after.skills.shared.status).toBe("managed");
    expect(after.skills.shared.preferredSourceId).toBe(a.id);
  });

  test("preferSkill rejects an unknown source id", async () => {
    await expect(preferSkill(store, indexStore, "x", "nope")).rejects.toThrow(/unknown source id/i);
  });

  test("preferSkill rejects a skill not present in the index", async () => {
    const dir = path.join(await tempDir("asm-pref-foo-"), "foo");
    await writeSkill(dir, "foo");
    const source = await addSource(store, dir);
    await refresh();
    await expect(preferSkill(store, indexStore, "missing", source.id)).rejects.toThrow(/skill not found/i);
  });

  test("preferSkill rejects when the source does not provide the skill", async () => {
    const dirFoo = path.join(await tempDir("asm-pf-foo-"), "foo");
    const dirBar = path.join(await tempDir("asm-pf-bar-"), "bar");
    await writeSkill(dirFoo, "foo");
    await writeSkill(dirBar, "bar");
    const fooSource = await addSource(store, dirFoo);
    const barSource = await addSource(store, dirBar);
    await refresh();
    await expect(preferSkill(store, indexStore, "foo", barSource.id)).rejects.toThrow(/does not provide/i);
  });
});
