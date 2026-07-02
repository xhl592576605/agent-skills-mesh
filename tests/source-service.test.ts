import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import type { AppConfig } from "../src/core/models/config.js";
import { ConfigStore } from "../src/core/storage/config-store.js";
import {
  addRepoSource,
  addSource,
  dedupeId,
  listSources,
  removeSource,
  setSourceEnabled,
  slugify,
  syncSources,
  type SyncResult
} from "../src/core/services/source-service.js";
import { pathExists, removeRecursive } from "../src/utils/fs.js";

const execFileAsync = promisify(execFile);

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function gitIn(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

async function makeRemoteRepo(): Promise<string> {
  const dir = await tempDir("asm-src-remote-");
  await execFileAsync("git", ["init", dir]);
  await gitIn(["config", "user.email", "test@example.com"], dir);
  await gitIn(["config", "user.name", "Test"], dir);
  await fs.mkdir(path.join(dir, "my-skill"), { recursive: true });
  await fs.writeFile(path.join(dir, "my-skill", "SKILL.md"), "---\nname: my-skill\n---\nhi\n", "utf8");
  await gitIn(["add", "."], dir);
  await execFileAsync("git", ["-C", dir, "commit", "-m", "initial"]);
  return dir;
}

/**
 * 构造完全隔离的临时 ASM_HOME：paths 指向临时目录，清空默认 source/agents，
 * 确保 refresh / git clone 绝不触碰真实 ~/.agents/skills / ~/.pi/skills。
 */
async function setupHome(): Promise<{ home: string; store: ConfigStore; config: AppConfig }> {
  const home = await tempDir("asm-src-home-");
  const store = new ConfigStore(home);
  const config = await store.init();
  config.paths = {
    home,
    repos: path.join(home, "repos"),
    local: path.join(home, "local"),
    cache: path.join(home, "cache")
  };
  config.sources = [];
  config.agents = {};
  await store.write(config);
  return { home, store, config };
}

async function makeDir(): Promise<string> {
  const dir = await tempDir("asm-src-dir-");
  return dir;
}

describe("source-service helpers", () => {
  test("slugify lowercases and strips path/url segments", () => {
    expect(slugify("~/Foo/My Skills")).toBe("my-skills");
    expect(slugify("https://github.com/x/Repo.git")).toBe("repo");
    expect(slugify("git@github.com:x/Y.git")).toBe("y");
  });

  test("dedupeId appends -2/-3 on conflict", () => {
    const config: AppConfig = {
      version: 1,
      settings: { install_strategy: "symlink", default_agent: "pi", auto_refresh_on_start: true },
      paths: { home: "", repos: "", local: "", cache: "" },
      sources: [
        { id: "skills", name: "a", type: "local-dir", path: "/a", enabled: true },
        { id: "skills-2", name: "b", type: "local-dir", path: "/b", enabled: true }
      ],
      agents: {},
      skillOverrides: {}
    };
    expect(dedupeId(config, "skills")).toBe("skills-3");
    expect(dedupeId(config, "free")).toBe("free");
  });
});

describe("source-service add / list", () => {
  let store: ConfigStore;

  beforeEach(async () => {
    ({ store } = await setupHome());
  });

  test("addSource registers a local-dir source and persists", async () => {
    const dir = await makeDir();
    const source = await addSource(store, dir);

    expect(source.type).toBe("local-dir");
    expect(source.path).toBe(path.resolve(dir));
    const reread = await store.read();
    expect(reread.sources.some((entry) => entry.id === source.id)).toBe(true);
    expect(listSources(reread)).toBe(reread.sources);
  });

  test("addSource rejects a non-existent path", async () => {
    await expect(addSource(store, path.join(os.tmpdir(), "asm-nope-" + Date.now()))).rejects.toThrow(/does not exist/i);
  });

  test("addSource rejects a regular file", async () => {
    const file = path.join(await tempDir("asm-src-file-"), "not-dir.txt");
    await fs.writeFile(file, "not a directory", "utf8");
    await expect(addSource(store, file)).rejects.toThrow(/not a directory/i);
  });

  test("addSource rejects a duplicate path", async () => {
    const dir = await makeDir();
    await addSource(store, dir);
    await expect(addSource(store, dir)).rejects.toThrow(/already registered/i);
  });

  test("addSource dedupes id for same basename", async () => {
    const parentA = await tempDir("asm-parent-a-");
    const parentB = await tempDir("asm-parent-b-");
    const dirA = path.join(parentA, "skills");
    const dirB = path.join(parentB, "skills");
    await fs.mkdir(dirA, { recursive: true });
    await fs.mkdir(dirB, { recursive: true });

    const a = await addSource(store, dirA);
    const b = await addSource(store, dirB);
    expect(a.id).toBe("skills");
    expect(b.id).toBe("skills-2");
  });

  test("addSource honors a custom id and rejects an existing custom id", async () => {
    const dirA = await makeDir();
    const dirB = await makeDir();
    await addSource(store, dirA, { id: "custom" });
    await expect(addSource(store, dirB, { id: "custom" })).rejects.toThrow(/already exists/i);
  });
});

describe("source-service add-repo", () => {
  let store: ConfigStore;

  beforeEach(async () => {
    ({ store } = await setupHome());
  });

  test("addRepoSource clones and registers a git-repo source", async () => {
    const remote = await makeRemoteRepo();
    const source = await addRepoSource(store, remote);

    expect(source.type).toBe("git-repo");
    expect(source.url).toBe(remote);
    expect(await pathExists(source.path)).toBe(true);
    expect(await pathExists(path.join(source.path, "my-skill", "SKILL.md"))).toBe(true);
    expect((await store.read()).sources.some((entry) => entry.id === source.id)).toBe(true);
  });

  test("addRepoSource does not write config on clone failure", async () => {
    const before = (await store.read()).sources.length;
    await expect(addRepoSource(store, "/nonexistent/asm-xyz-repo")).rejects.toThrow();
    expect((await store.read()).sources.length).toBe(before);
  });

  test("addRepoSource rejects a duplicate url", async () => {
    const remote = await makeRemoteRepo();
    await addRepoSource(store, remote);
    await expect(addRepoSource(store, remote)).rejects.toThrow(/already registered/i);
  });
});

describe("source-service sync", () => {
  let store: ConfigStore;

  beforeEach(async () => {
    ({ store } = await setupHome());
  });

  test("syncSources clones a missing repo then pulls on subsequent sync", async () => {
    const remote = await makeRemoteRepo();
    const source = await addRepoSource(store, remote);

    // 模拟 clone 目录缺失 → sync 应重新 clone
    await removeRecursive(source.path);
    const cloneResults = await syncSources(store);
    expect(cloneResults).toHaveLength(1);
    expect(cloneResults[0].action).toBe("clone");
    expect(cloneResults[0].success).toBe(true);
    expect(await pathExists(source.path)).toBe(true);

    // 已存在 → pull --ff-only（已是最新，fastForward true）
    const pullResults = await syncSources(store);
    expect(pullResults[0].action).toBe("pull");
    expect(pullResults[0].success).toBe(true);
  });

  test("syncSources with id syncs only that source", async () => {
    const remote = await makeRemoteRepo();
    const source = await addRepoSource(store, remote);
    await removeRecursive(source.path);

    const results: SyncResult[] = await syncSources(store, source.id);
    expect(results).toHaveLength(1);
    expect(results[0].sourceId).toBe(source.id);
  });

  test("syncSources rejects unknown id and non-git-repo source", async () => {
    const dir = await makeDir();
    const local = await addSource(store, dir);

    await expect(syncSources(store, "nope")).rejects.toThrow(/unknown source id/i);
    await expect(syncSources(store, local.id)).rejects.toThrow(/not a git-repo/i);
  });
});

describe("source-service enable / disable / remove", () => {
  let store: ConfigStore;

  beforeEach(async () => {
    ({ store } = await setupHome());
  });

  test("setSourceEnabled toggles and persists", async () => {
    const dir = await makeDir();
    const source = await addSource(store, dir);

    await setSourceEnabled(store, source.id, false);
    expect((await store.read()).sources.find((entry) => entry.id === source.id)?.enabled).toBe(false);
    await setSourceEnabled(store, source.id, true);
    expect((await store.read()).sources.find((entry) => entry.id === source.id)?.enabled).toBe(true);
  });

  test("setSourceEnabled rejects unknown id", async () => {
    await expect(setSourceEnabled(store, "nope", true)).rejects.toThrow(/unknown source id/i);
  });

  test("removeSource removes from config but keeps cloned dir by default", async () => {
    const remote = await makeRemoteRepo();
    const source = await addRepoSource(store, remote);
    const cloned = source.path;

    await removeSource(store, source.id);
    expect((await store.read()).sources.some((entry) => entry.id === source.id)).toBe(false);
    expect(await pathExists(cloned)).toBe(true);
  });

  test("removeSource --purge deletes the cloned dir", async () => {
    const remote = await makeRemoteRepo();
    const source = await addRepoSource(store, remote);
    const cloned = source.path;

    await removeSource(store, source.id, { purge: true });
    expect(await pathExists(cloned)).toBe(false);
  });

  test("removeSource --purge refuses paths outside repos dir", async () => {
    const dir = await makeDir();
    const source = await addSource(store, dir);
    await expect(removeSource(store, source.id, { purge: true })).rejects.toThrow(/not under repos/i);
    // purge 失败时 config 不应被改动
    expect((await store.read()).sources.some((entry) => entry.id === source.id)).toBe(true);
  });

  test("removeSource rejects unknown id", async () => {
    await expect(removeSource(store, "nope")).rejects.toThrow(/unknown source id/i);
  });
});
