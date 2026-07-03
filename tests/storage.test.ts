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
