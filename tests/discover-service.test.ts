import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import type { AppConfig } from "../src/core/models/config.js";
import type { IndexFile } from "../src/core/models/index.js";
import type { InstallationRecord } from "../src/core/models/installation.js";
import type { SkillCandidate, SkillRecord, SkillStatus } from "../src/core/models/skill.js";
import { adoptSkill, listDiscover, setIgnored } from "../src/core/services/discover-service.js";
import { refreshIndex } from "../src/core/services/refresh-service.js";
import { ConfigStore } from "../src/core/storage/config-store.js";
import { IndexStore } from "../src/core/storage/index-store.js";
import { StateStore } from "../src/core/storage/state-store.js";
import { pathExists } from "../src/utils/fs.js";

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeSkill(dir: string, name: string, body = "body"): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\n${body}\n`, "utf8");
}

async function setupHome(): Promise<{ home: string; configStore: ConfigStore; indexStore: IndexStore; stateStore: StateStore; globalDir: string; agentDir: string }> {
  const home = await tempDir("asm-discover-home-");
  const globalDir = path.join(home, "global-skills");
  const agentDir = path.join(home, "pi-skills");
  await fs.mkdir(globalDir, { recursive: true });
  await fs.mkdir(agentDir, { recursive: true });

  const configStore = new ConfigStore(home);
  const indexStore = new IndexStore(home);
  const stateStore = new StateStore(home);
  const config = await configStore.init();
  config.paths = {
    home,
    repos: path.join(home, "repos"),
    local: path.join(home, "local"),
    cache: path.join(home, "cache"),
    skills: globalDir
  };
  config.sources = [];
  config.agents = { pi: { name: "Pi", enabled: true, skills_dir: agentDir } };
  config.skillOverrides = {};
  await configStore.write(config);
  await indexStore.init({ force: true });
  await stateStore.init({ force: true });
  return { home, configStore, indexStore, stateStore, globalDir, agentDir };
}

async function refreshStores(configStore: ConfigStore, indexStore: IndexStore, stateStore = new StateStore(configStore.home)): Promise<IndexFile> {
  const index = await refreshIndex(await configStore.read(), await indexStore.read(), await stateStore.read());
  await indexStore.write(index);
  return index;
}

function candidate(skillName: string, sourceId: string, skillPath: string): SkillCandidate {
  return {
    id: `${sourceId}:${skillName}:hash`,
    skillName,
    sourceId,
    sourceType: "agent-dir",
    path: skillPath,
    entry: "SKILL.md",
    tags: [],
    hash: "hash",
    mtimeMs: 1,
    size: 1,
    origin: "agent-dir",
    managed: false
  };
}

function skill(name: string, status: SkillStatus, candidates: SkillCandidate[], ignored = false): SkillRecord {
  return {
    name,
    displayName: name,
    status,
    tags: [],
    candidates,
    ignored: ignored || undefined
  };
}

function installation(record: Partial<InstallationRecord> & Pick<InstallationRecord, "skillName" | "agentId" | "status" | "targetPath">): InstallationRecord {
  return {
    id: `${record.skillName}:${record.agentId}`,
    ...record
  };
}

describe("listDiscover", () => {
  test("lists discovered/conflict/external/broken-link and filters ignored skills", () => {
    const index: IndexFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      sources: {},
      skills: {
        discovered: skill("discovered", "discovered", [candidate("discovered", "agent", "/tmp/discovered")]),
        conflict: skill("conflict", "conflict", [candidate("conflict", "a", "/tmp/a"), candidate("conflict", "b", "/tmp/b")]),
        external: skill("external", "managed", [candidate("external", "src", "/tmp/external-src")]),
        broken: skill("broken", "managed", [candidate("broken", "src", "/tmp/broken-src")]),
        ignored: skill("ignored", "ignored", [candidate("ignored", "src", "/tmp/ignored-src")], true)
      },
      installations: {
        "external:pi": installation({ skillName: "external", agentId: "pi", status: "external", targetPath: "/tmp/pi/external", reason: "target is a real skill directory" }),
        "broken:pi": installation({ skillName: "broken", agentId: "pi", status: "broken-link", targetPath: "/tmp/pi/broken", linkTarget: "/tmp/missing", reason: "symlink target is missing" }),
        "ignored:pi": installation({ skillName: "ignored", agentId: "pi", status: "external", targetPath: "/tmp/pi/ignored" })
      },
      issues: []
    };

    const entries = listDiscover(index);

    expect(entries).toHaveLength(4);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "discovered", skillName: "discovered" }),
      expect.objectContaining({ kind: "conflict", skillName: "conflict" }),
      expect.objectContaining({ kind: "external", skillName: "external" }),
      expect.objectContaining({ kind: "broken-link", skillName: "broken" })
    ]));
    expect(entries.some((entry) => entry.skillName === "ignored")).toBe(false);
  });
});

describe("adoptSkill", () => {
  let configStore: ConfigStore;
  let indexStore: IndexStore;
  let stateStore: StateStore;
  let globalDir: string;
  let agentDir: string;

  beforeEach(async () => {
    ({ configStore, indexStore, stateStore, globalDir, agentDir } = await setupHome());
  });

  test("moves a discovered real directory into global source, symlinks back, writes managed override, and refreshes index", async () => {
    const original = path.join(agentDir, "my-helper");
    const target = path.join(globalDir, "my-helper");
    await writeSkill(original, "my-helper");

    const before = await refreshStores(configStore, indexStore, stateStore);
    expect(before.skills["my-helper"].status).toBe("discovered");

    const result = await adoptSkill(configStore, indexStore, "my-helper", stateStore);

    expect(result).toMatchObject({ skillName: "my-helper", sourcePath: original, targetPath: target });
    expect(await pathExists(path.join(target, "SKILL.md"))).toBe(true);
    const originalStat = await fs.lstat(original);
    expect(originalStat.isSymbolicLink()).toBe(true);
    expect(path.resolve(path.dirname(original), await fs.readlink(original))).toBe(target);

    expect((await stateStore.read()).installedSkills["my-helper"]?.ssotPath).toBe(target);

    const after = await indexStore.read();
    expect(after.skills["my-helper"].status).toBe("managed");
    expect(after.installations["my-helper:pi"].status).toBe("installed");
  });

  test("adopt writes installed state and symlinks the original agent path", async () => {
    const original = path.join(agentDir, "global-helper");
    const target = path.join(globalDir, "global-helper");
    await writeSkill(original, "global-helper");

    const before = await refreshStores(configStore, indexStore, stateStore);
    expect(before.skills["global-helper"].status).toBe("discovered");

    const result = await adoptSkill(configStore, indexStore, "global-helper", stateStore);

    expect(result).toMatchObject({ skillName: "global-helper", sourcePath: original, targetPath: target });
    expect((await fs.lstat(original)).isSymbolicLink()).toBe(true);
    expect((await stateStore.read()).installedSkills["global-helper"]?.source.kind).toBe("manual-import");
    expect((await indexStore.read()).skills["global-helper"].status).toBe("managed");
  });

  test("refuses an existing adopt target and does not overwrite it", async () => {
    const original = path.join(agentDir, "my-helper");
    const target = path.join(globalDir, "my-helper");
    await writeSkill(original, "my-helper", "original");
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "marker.txt"), "existing", "utf8");
    await refreshStores(configStore, indexStore, stateStore);

    await expect(adoptSkill(configStore, indexStore, "my-helper", stateStore)).rejects.toThrow(/already exists/i);

    expect((await fs.lstat(original)).isDirectory()).toBe(true);
    expect((await fs.lstat(original)).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(path.join(target, "marker.txt"), "utf8")).toBe("existing");
    expect((await configStore.read()).skillOverrides["my-helper"]).toBeUndefined();
  });

  test("rejects a skill with multiple candidates", async () => {
    const otherAgentDir = path.join(path.dirname(agentDir), "claude-skills");
    await fs.mkdir(otherAgentDir, { recursive: true });
    const config = await configStore.read();
    config.agents.claude = { name: "Claude", enabled: true, skills_dir: otherAgentDir };
    await configStore.write(config);

    await writeSkill(path.join(agentDir, "shared"), "shared", "a");
    await writeSkill(path.join(otherAgentDir, "shared"), "shared", "b");
    const index = await refreshStores(configStore, indexStore, stateStore);
    expect(index.skills.shared.candidates).toHaveLength(2);

    await expect(adoptSkill(configStore, indexStore, "shared", stateStore)).rejects.toThrow(/not discovered|exactly one/i);
  });
});

describe("setIgnored", () => {
  let configStore: ConfigStore;
  let indexStore: IndexStore;
  let stateStore: StateStore;
  let agentDir: string;

  beforeEach(async () => {
    ({ configStore, indexStore, stateStore, agentDir } = await setupHome());
  });

  test("writes ignored override, refreshes to ignored, then unignore removes empty override", async () => {
    await writeSkill(path.join(agentDir, "noisy"), "noisy");
    const before = await refreshStores(configStore, indexStore, stateStore);
    expect(before.skills.noisy.status).toBe("discovered");

    await setIgnored(configStore, indexStore, "noisy", true, stateStore);
    expect((await configStore.read()).skillOverrides.noisy?.ignored).toBe(true);
    const ignoredIndex = await indexStore.read();
    expect(ignoredIndex.skills.noisy.status).toBe("ignored");
    expect(listDiscover(ignoredIndex).some((entry) => entry.skillName === "noisy")).toBe(false);

    await setIgnored(configStore, indexStore, "noisy", false, stateStore);
    expect((await configStore.read()).skillOverrides.noisy).toBeUndefined();
    const unignoredIndex = await indexStore.read();
    expect(unignoredIndex.skills.noisy.status).toBe("discovered");
  });

  test("rejects an unknown skill name", async () => {
    await refreshStores(configStore, indexStore, stateStore);
    await expect(setIgnored(configStore, indexStore, "typo", true, stateStore)).rejects.toThrow(/Skill not found/);
  });
});
