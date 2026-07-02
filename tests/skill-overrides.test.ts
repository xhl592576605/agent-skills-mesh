import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import type { AppConfig, SkillOverride } from "../src/core/models/config.js";
import { ConfigStore, createDefaultConfig } from "../src/core/storage/config-store.js";
import { refreshIndex } from "../src/core/services/refresh-service.js";

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeSkill(dir: string, content = "---\nname: skill\n---\nbody"): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), content, "utf8");
}

/** 构造最小可用 config：sources 指向临时目录，agents 置空避免扫描真实 agent 目录。 */
function makeConfig(sources: AppConfig["sources"], skillOverrides: Record<string, SkillOverride> = {}): AppConfig {
  return {
    version: 1,
    settings: { install_strategy: "symlink", default_agent: "pi", auto_refresh_on_start: true },
    paths: { home: "", repos: "", local: "", cache: "" },
    sources,
    agents: {},
    skillOverrides
  };
}

describe("skill-overrides serialization", () => {
  let home: string;
  let store: ConfigStore;

  beforeEach(async () => {
    home = await tempDir("asm-overrides-");
    store = new ConfigStore(home);
    await store.init();
  });

  test("round-trips managed / ignored / preferredSourceId / preferredCandidateId", async () => {
    const config = createDefaultConfig();
    config.skillOverrides = {
      "adopted-skill": { managed: true },
      "noisy-skill": { ignored: true },
      "ambiguous-skill": { preferredSourceId: "src-a" },
      "pinned-skill": { preferredCandidateId: "src-a:ambiguous:deadbeef", managed: true, ignored: true }
    };

    await store.write(config);
    const restored = await store.read();

    expect(restored.skillOverrides).toEqual(config.skillOverrides);
  });

  test("rejects invalid override names before writing config", async () => {
    const config = createDefaultConfig();
    config.skillOverrides = { "bad.name": { managed: true } };

    await expect(store.write(config)).rejects.toThrow(/Invalid skill-overrides section name/);
  });

  test("rejects invalid section name containing a dot", async () => {
    await fs.writeFile(
      store.configPath,
      "version = 1\n[skill-overrides.bad.name]\nmanaged = true\n",
      "utf8"
    );
    await expect(store.read()).rejects.toThrow(/Invalid skill-overrides section name/);
  });

  test("rejects invalid section name containing a space", async () => {
    await fs.writeFile(
      store.configPath,
      "version = 1\n[skill-overrides.bad name]\nmanaged = true\n",
      "utf8"
    );
    await expect(store.read()).rejects.toThrow(/Invalid skill-overrides section name/);
  });
});

describe("skill-overrides in refresh", () => {
  test("discovered skill becomes managed when override.managed is set", async () => {
    const globalDir = await tempDir("asm-overrides-global-");
    await writeSkill(path.join(globalDir, "my-skill"), "---\nname: my-skill\n---\nbody");

    const config = makeConfig(
      [{ id: "global", name: "Global", type: "global-dir", path: globalDir, enabled: true }],
      { "my-skill": { managed: true } }
    );

    const index = await refreshIndex(config);
    expect(index.skills["my-skill"].status).toBe("managed");
  });

  test("multi-candidate conflict resolves to managed with preferredSourceId", async () => {
    const dirA = await tempDir("asm-overrides-a-");
    const dirB = await tempDir("asm-overrides-b-");
    await writeSkill(path.join(dirA, "shared"), "---\nname: shared\n---\na");
    await writeSkill(path.join(dirB, "shared"), "---\nname: shared\n---\nb");

    const sources = [
      { id: "src-a", name: "A", type: "local-dir" as const, path: dirA, enabled: true },
      { id: "src-b", name: "B", type: "local-dir" as const, path: dirB, enabled: true }
    ];

    const withoutPref = await refreshIndex(makeConfig(sources));
    expect(withoutPref.skills.shared.status).toBe("conflict");

    const withPref = await refreshIndex(makeConfig(sources, { shared: { preferredSourceId: "src-a" } }));
    expect(withPref.skills.shared.status).toBe("managed");
    expect(withPref.skills.shared.preferredSourceId).toBe("src-a");
  });

  test("stale preferredSourceId keeps conflict when no matching candidate", async () => {
    const dirA = await tempDir("asm-overrides-stale-");
    const dirB = await tempDir("asm-overrides-stale2-");
    await writeSkill(path.join(dirA, "shared"), "---\nname: shared\n---\na");
    await writeSkill(path.join(dirB, "shared"), "---\nname: shared\n---\nb");

    const sources = [
      { id: "src-a", name: "A", type: "local-dir" as const, path: dirA, enabled: true },
      { id: "src-b", name: "B", type: "local-dir" as const, path: dirB, enabled: true }
    ];

    const index = await refreshIndex(makeConfig(sources, { shared: { preferredSourceId: "does-not-exist" } }));
    expect(index.skills.shared.status).toBe("conflict");
    // 未解析成功的偏好不写入 SkillRecord（事实层保持干净）。
    expect(index.skills.shared.preferredSourceId).toBeUndefined();
  });

  test("override.ignored wins over discovered status", async () => {
    const globalDir = await tempDir("asm-overrides-ignored-");
    await writeSkill(path.join(globalDir, "noisy"), "---\nname: noisy\n---\nbody");

    const config = makeConfig(
      [{ id: "global", name: "Global", type: "global-dir", path: globalDir, enabled: true }],
      { noisy: { ignored: true } }
    );

    const index = await refreshIndex(config);
    expect(index.skills.noisy.status).toBe("ignored");
    expect(index.skills.noisy.ignored).toBe(true);
  });
});
