import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ConfigStore } from "../src/core/storage/config-store.js";
import { IndexStore } from "../src/core/storage/index-store.js";
import { StateStore } from "../src/core/storage/state-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "asm-storage-"));
}

describe("storage init", () => {
  test("does not overwrite existing config or index without force", async () => {
    const home = await tempDir();
    const configStore = new ConfigStore(home);
    const indexStore = new IndexStore(home);

    await configStore.init();
    await indexStore.init();

    await fs.writeFile(configStore.configPath, "version = 1\n# user custom config\n", "utf8");
    const existingIndex = { version: 1, updatedAt: "custom", sources: {}, skills: {}, installations: {}, issues: [] };
    await indexStore.write(existingIndex);

    await configStore.init();
    await indexStore.init();

    await expect(fs.readFile(configStore.configPath, "utf8")).resolves.toContain("user custom config");
    await expect(indexStore.read()).resolves.toMatchObject({ updatedAt: "custom" });
  });

  test("force init overwrites existing config and index", async () => {
    const home = await tempDir();
    const configStore = new ConfigStore(home);
    const indexStore = new IndexStore(home);

    await configStore.init();
    await indexStore.init();
    await fs.writeFile(configStore.configPath, "version = 1\n# user custom config\n", "utf8");
    await indexStore.write({ version: 1, updatedAt: "custom", sources: {}, skills: {}, installations: {}, issues: [] });

    await configStore.init({ force: true });
    await indexStore.init({ force: true });

    await expect(fs.readFile(configStore.configPath, "utf8")).resolves.not.toContain("user custom config");
    await expect(indexStore.read()).resolves.not.toMatchObject({ updatedAt: "custom" });
  });

  test("state store round-trips installed skills", async () => {
    const home = await tempDir();
    const stateStore = new StateStore(home);
    const state = await stateStore.init();
    state.installedSkills.foo = {
      skillName: "foo",
      displayName: "foo",
      tags: [],
      ssotPath: path.join(home, "skills", "foo"),
      source: { kind: "manual-import", originalPath: "/tmp/foo" },
      contentHash: "hash",
      installedAt: "2026-07-03T00:00:00.000Z",
      updatedAt: "2026-07-03T00:00:00.000Z",
      enabledAgents: { pi: { agentId: "pi", targetPath: "/tmp/pi/foo", linkedAt: "2026-07-03T00:00:00.000Z" } }
    };
    await stateStore.write(state);
    await expect(stateStore.read()).resolves.toEqual(state);
  });
});

describe("config.language field", () => {
  test("createDefaultConfig sets language to auto and serializes it", async () => {
    const home = await tempDir();
    const configStore = new ConfigStore(home);
    const config = await configStore.init();
    expect(config.settings.language).toBe("auto");
    // 序列化后文件含 language 行
    const raw = await fs.readFile(configStore.configPath, "utf8");
    expect(raw).toContain('language = "auto"');
  });

  test("round-trips language zh-CN / en", async () => {
    const home = await tempDir();
    const configStore = new ConfigStore(home);
    const config = await configStore.init();
    config.settings.language = "zh-CN";
    await configStore.write(config);
    const reread = await configStore.read();
    expect(reread.settings.language).toBe("zh-CN");
  });

  test("legacy config without language line defaults to auto", async () => {
    const home = await tempDir();
    const configStore = new ConfigStore(home);
    // 模拟旧 config：settings 段无 language 行
    const legacy = [
      "version = 1",
      "",
      "[settings]",
      'install_strategy = "symlink"',
      'default_agent = "pi"',
      "auto_refresh_on_start = true",
      "",
      "[paths]",
      'home = "~/.agent-skills-mesh"',
      'repos = "~/.agent-skills-mesh/repos"',
      'local = "~/.agent-skills-mesh/local"',
      'cache = "~/.agent-skills-mesh/cache"',
      'skills = "~/.agent-skills-mesh/skills"',
      ""
    ].join("\n");
    await fs.writeFile(configStore.configPath, legacy, "utf8");
    const config = await configStore.read();
    expect(config.settings.language).toBe("auto");
  });
});

describe("state sourceSnapshots & sourceHash", () => {
  test("round-trips sourceSnapshots", async () => {
    const home = await tempDir();
    const stateStore = new StateStore(home);
    const state = await stateStore.init();
    state.sourceSnapshots = {
      "src-1": { fingerprint: "abc123", hasUpdate: true, checkedAt: "2026-07-15T00:00:00.000Z" }
    };
    await stateStore.write(state);
    const read = await stateStore.read();
    expect(read.sourceSnapshots).toEqual(state.sourceSnapshots);
  });

  test("round-trips sourceHash on an installed skill", async () => {
    const home = await tempDir();
    const stateStore = new StateStore(home);
    const state = await stateStore.init();
    state.installedSkills.foo = {
      skillName: "foo",
      displayName: "foo",
      tags: [],
      ssotPath: path.join(home, "skills/foo"),
      source: {
        kind: "configured-source",
        sourceId: "s1",
        sourceType: "git-repo",
        sourcePath: "/tmp/s1",
        relativePath: "foo"
      },
      contentHash: "c1",
      sourceHash: "s2",
      installedAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      enabledAgents: {}
    };
    await stateStore.write(state);
    const read = await stateStore.read();
    expect(read.installedSkills.foo?.sourceHash).toBe("s2");
  });

  test("legacy state without sourceSnapshots defaults to {}", async () => {
    const home = await tempDir();
    const stateStore = new StateStore(home);
    // 模拟旧 state：无 sourceSnapshots 字段，installed skill 无 sourceHash
    const legacy = {
      version: 1,
      installedSkills: {
        foo: {
          skillName: "foo",
          displayName: "foo",
          tags: [],
          ssotPath: "/tmp/foo",
          source: { kind: "manual-import" },
          contentHash: "c1",
          installedAt: "2026-07-15T00:00:00.000Z",
          updatedAt: "2026-07-15T00:00:00.000Z",
          enabledAgents: {}
        }
      }
    };
    await fs.writeFile(stateStore.statePath, JSON.stringify(legacy), "utf8");
    const read = await stateStore.read();
    expect(read.sourceSnapshots).toEqual({});
    expect(read.installedSkills.foo?.sourceHash).toBeUndefined();
  });
});
