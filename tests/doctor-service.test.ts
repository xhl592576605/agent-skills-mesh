import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { AppConfig } from "../src/core/models/config.js";
import type { IndexFile, IssueRecord } from "../src/core/models/index.js";
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
    paths: { home: "", repos: "", local: "", cache: "", skills: "" },
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

function indexWith(skills: SkillRecord[], installations: InstallationRecord[], issues: IssueRecord[] = []): IndexFile {
  const skillMap: Record<string, SkillRecord> = {};
  for (const entry of skills) skillMap[entry.name] = entry;
  const installationMap: Record<string, InstallationRecord> = {};
  for (const entry of installations) installationMap[entry.id] = entry;
  return { version: 1, updatedAt: new Date().toISOString(), skills: skillMap, installations: installationMap, issues };
}

describe("runDoctor fix annotations", () => {
  test("attaches refresh-index fix when index is missing", async () => {
    const home = await tempDir("asm-doc-home-");
    const configStore = new ConfigStore(home);
    const indexStore = new IndexStore(home);
    await configStore.init();
    // 不写 index
    const cfg = config(await tempDir("asm-doc-agent-"));
    const checks = await runDoctor(configStore, indexStore, cfg, undefined);
    const indexCheck = checks.find((c) => c.kind === "index");
    expect(indexCheck?.status).toBe("error");
    expect(indexCheck?.fix).toEqual({ type: "refresh-index" });
  });

  test("attaches mkdir-agent-dir fix when agent skills_dir is missing", async () => {
    const home = await tempDir("asm-doc-home-");
    const configStore = new ConfigStore(home);
    const indexStore = new IndexStore(home);
    await configStore.init();
    await indexStore.init();
    const missingDir = path.join(await tempDir("asm-doc-missing-"), "skills");
    const cfg = config(missingDir);
    const checks = await runDoctor(configStore, indexStore, cfg, indexWith([], []));
    const agentDirCheck = checks.find((c) => c.kind === "agent-dir");
    expect(agentDirCheck?.status).toBe("warning");
    expect(agentDirCheck?.fix).toEqual({ type: "mkdir-agent-dir", agentId: "pi", targetPath: missingDir });
  });

  test("attaches repair-broken-link fix for broken-link issues", async () => {
    const home = await tempDir("asm-doc-home-");
    const configStore = new ConfigStore(home);
    const indexStore = new IndexStore(home);
    await configStore.init();
    await indexStore.init();

    const agentDir = await tempDir("asm-doc-agent-");
    const cfg = config(agentDir);
    const targetPath = path.join(agentDir, "foo");
    const index = indexWith(
      [skillRecord("foo")],
      [brokenLinkInstallation("foo", "pi", targetPath)],
      [{ id: "broken-link:foo:pi", severity: "warning", kind: "broken-link", message: `Broken symlink: ${targetPath}`, ref: "foo:pi" }]
    );

    const checks = await runDoctor(configStore, indexStore, cfg, index);
    const brokenLinkCheck = checks.find((c) => c.kind === "broken-link");
    expect(brokenLinkCheck?.status).toBe("warning");
    expect(brokenLinkCheck?.fix).toEqual({ type: "repair-broken-link", skillName: "foo", agentId: "pi", targetPath });
  });

  test("does not attach fix to non-repairable issue checks (conflict)", async () => {
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
    const index = indexWith(
      [skillRecord("foo")],
      [conflictInstallation],
      [{ id: "install-conflict:foo:pi", severity: "warning", kind: "install-conflict", message: "Installation conflict", ref: "foo:pi" }]
    );

    const checks = await runDoctor(configStore, indexStore, cfg, index);
    const conflictCheck = checks.find((c) => c.kind === "install-conflict");
    expect(conflictCheck?.fix).toBeUndefined();
  });
});
