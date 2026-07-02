import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { AppConfig } from "../src/core/models/config.js";
import type { IndexFile } from "../src/core/models/index.js";
import type { InstallationRecord } from "../src/core/models/installation.js";
import type { SkillRecord } from "../src/core/models/skill.js";
import { runDoctor } from "../src/core/services/doctor-service.js";
import { ConfigStore } from "../src/core/storage/config-store.js";
import { IndexStore } from "../src/core/storage/index-store.js";

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function config(agentDir: string, enabled = true): AppConfig {
  return {
    version: 1,
    settings: { install_strategy: "symlink", default_agent: "pi", auto_refresh_on_start: true },
    paths: { home: "", repos: "", local: "", cache: "" },
    sources: [],
    agents: { pi: { name: "Pi", enabled, skills_dir: agentDir } }
  };
}

function skillRecord(name: string): SkillRecord {
  return { name, displayName: name, status: "managed", tags: [], candidates: [] };
}

function brokenLinkInstallation(skillName: string, agentId: string, targetPath: string): InstallationRecord {
  return { id: `${skillName}:${agentId}`, skillName, agentId, status: "broken-link", targetPath, linkTarget: path.join(targetPath, "missing"), reason: "symlink target is missing" };
}

function indexWith(skills: SkillRecord[], installations: InstallationRecord[]): IndexFile {
  const skillMap: Record<string, SkillRecord> = {};
  for (const entry of skills) skillMap[entry.name] = entry;
  const installationMap: Record<string, InstallationRecord> = {};
  for (const entry of installations) installationMap[entry.id] = entry;
  return { version: 1, updatedAt: new Date().toISOString(), sources: {}, skills: skillMap, installations: installationMap, issues: [] };
}

describe("runDoctor fix annotations", () => {
  test("attaches refresh-index fix when index is missing", async () => {
    const home = await tempDir("asm-doc-home-");
    const configStore = new ConfigStore(home);
    const indexStore = new IndexStore(home);
    // 仅写 config，不写 index，使 index 检查项走 error 分支。
    await configStore.init();

    const checks = await runDoctor(configStore, indexStore);
    const indexCheck = checks.find((check) => check.kind === "index");
    expect(indexCheck?.status).toBe("error");
    expect(indexCheck?.fix).toEqual({ type: "refresh-index" });
  });

  test("attaches mkdir-agent-dir fix when an enabled agent skills_dir is missing", async () => {
    const home = await tempDir("asm-doc-home-");
    const configStore = new ConfigStore(home);
    const indexStore = new IndexStore(home);
    await configStore.init();
    await indexStore.init();

    const missingDir = path.join(home, "missing-agent-dir");
    const cfg = config(missingDir);

    const checks = await runDoctor(configStore, indexStore, cfg, indexWith([], []));
    const agentDirCheck = checks.find((check) => check.kind === "agent-dir");
    expect(agentDirCheck?.status).toBe("warning");
    expect(agentDirCheck?.fix).toEqual({ type: "mkdir-agent-dir", agentId: "pi", targetPath: missingDir });
  });

  test("attaches repair-broken-link fix for broken-link installations", async () => {
    const home = await tempDir("asm-doc-home-");
    const configStore = new ConfigStore(home);
    const indexStore = new IndexStore(home);
    await configStore.init();
    await indexStore.init();

    const agentDir = await tempDir("asm-doc-agent-");
    const cfg = config(agentDir);
    const targetPath = path.join(agentDir, "foo");
    const index = indexWith([skillRecord("foo")], [brokenLinkInstallation("foo", "pi", targetPath)]);

    const checks = await runDoctor(configStore, indexStore, cfg, index);
    const brokenLinkCheck = checks.find((check) => check.kind === "broken-link");
    expect(brokenLinkCheck?.status).toBe("warning");
    expect(brokenLinkCheck?.fix).toEqual({ type: "repair-broken-link", skillName: "foo", agentId: "pi", targetPath });
  });

  test("does not attach fix to non-repairable checks (conflict, not writable)", async () => {
    const home = await tempDir("asm-doc-home-");
    const configStore = new ConfigStore(home);
    const indexStore = new IndexStore(home);
    await configStore.init();
    await indexStore.init();

    const agentDir = await tempDir("asm-doc-agent-");
    const cfg = config(agentDir);
    const conflictInstallation: InstallationRecord = {
      id: "foo:pi",
      skillName: "foo",
      agentId: "pi",
      status: "conflict",
      targetPath: path.join(agentDir, "foo"),
      reason: "symlink points to another candidate"
    };
    const index = indexWith([skillRecord("foo")], [conflictInstallation]);

    const checks = await runDoctor(configStore, indexStore, cfg, index);
    const conflictCheck = checks.find((check) => check.kind === "conflict");
    expect(conflictCheck?.fix).toBeUndefined();
  });
});
