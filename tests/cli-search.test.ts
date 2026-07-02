import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { AppConfig } from "../src/core/models/config.js";
import { ConfigStore } from "../src/core/storage/config-store.js";
import { IndexStore } from "../src/core/storage/index-store.js";
import { refreshIndex } from "../src/core/services/refresh-service.js";
import { addSource } from "../src/core/services/source-service.js";
import { searchSkills } from "../src/core/services/skill-service.js";
import { formatSkillRows } from "../src/cli/skill-format.js";

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function setupHome(): Promise<{ store: ConfigStore; indexStore: IndexStore }> {
  const home = await tempDir("asm-cli-search-");
  const store = new ConfigStore(home);
  const config: AppConfig = await store.init();
  config.paths = { home, repos: path.join(home, "repos"), local: path.join(home, "local"), cache: path.join(home, "cache") };
  config.sources = [];
  config.agents = {};
  await store.write(config);
  return { store, indexStore: new IndexStore(home) };
}

async function writeSkill(dir: string, name: string, description?: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const front = description ? `---\nname: ${name}\ndescription: ${description}\n---\n` : `---\nname: ${name}\n---\n`;
  await fs.writeFile(path.join(dir, "SKILL.md"), `${front}body\n`, "utf8");
}

async function refresh(store: ConfigStore, indexStore: IndexStore) {
  const index = await refreshIndex(await store.read());
  await indexStore.write(index);
  return index;
}

describe("asm skill search (CLI format + filtering)", () => {
  let store: ConfigStore;
  let indexStore: IndexStore;

  test("search + formatSkillRows produces list-aligned rows", async () => {
    ({ store, indexStore } = await setupHome());
    const reactDir = path.join(await tempDir("asm-s-react-"), "react-helper");
    const reactSrc = path.join(await tempDir("asm-s-react-src-"), "react-core");
    const backendDir = path.join(await tempDir("asm-s-backend-"), "backend-tools");
    await writeSkill(reactDir, "react-helper", "UI components");
    await writeSkill(reactSrc, "react-core", "core react skill");
    await writeSkill(backendDir, "backend-tools", "server utils");
    await addSource(store, path.dirname(reactDir));
    await addSource(store, path.dirname(reactSrc));
    await addSource(store, path.dirname(backendDir));
    const index = await refresh(store, indexStore);

    // 与 `asm skill list` 同格式（name\tstatus\tdescription），结果按 name 排序。
    const reactRows = formatSkillRows(searchSkills(index, "react"));
    expect(reactRows).toEqual([
      "react-core\tmanaged\tcore react skill",
      "react-helper\tmanaged\tUI components"
    ]);

    // 空关键字返回全部，等价于 list 的全集。
    const allRows = formatSkillRows(searchSkills(index, ""));
    expect(allRows.map((line) => line.split("\t")[0])).toEqual([
      "backend-tools",
      "react-core",
      "react-helper"
    ]);

    // description 命中。
    expect(formatSkillRows(searchSkills(index, "server"))).toEqual(["backend-tools\tmanaged\tserver utils"]);

    // 无匹配返回空 → CLI 分支据此打印 "No skills matching '<kw>'"。
    expect(searchSkills(index, "nonexistent")).toEqual([]);
  });

  test("empty index yields no rows", async () => {
    ({ store, indexStore } = await setupHome());
    const index = await refresh(store, indexStore);
    expect(formatSkillRows(searchSkills(index, "anything"))).toEqual([]);
  });
});

describe("asm tui lazy import", () => {
  test("App module resolves and exports a renderable component", async () => {
    // 防止 `asm tui` 懒加载路径拼写错误（NodeNext .js 扩展）。仅校验模块可解析且 App 是函数，
    // 不实际 render（交互式 TUI 由 ink-testing-library 在组件层覆盖）。
    const mod = await import("../src/tui/App.js");
    expect(typeof mod.App).toBe("function");
  });
});
