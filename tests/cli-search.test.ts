import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { AppConfig } from "../src/core/models/config.js";
import { ConfigStore } from "../src/core/storage/config-store.js";
import { IndexStore } from "../src/core/storage/index-store.js";
import { StateStore } from "../src/core/storage/state-store.js";
import { refreshIndex } from "../src/core/services/refresh-service.js";
import { addSource } from "../src/core/services/source-service.js";
import { searchSkills } from "../src/core/services/skill-service.js";
import { formatSkillRows } from "../src/cli/skill-format.js";

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function setupHome(): Promise<{ store: ConfigStore; indexStore: IndexStore; stateStore: StateStore }> {
  const home = await tempDir("asm-cli-search-");
  const store = new ConfigStore(home);
  const indexStore = new IndexStore(home);
  const stateStore = new StateStore(home);
  const config: AppConfig = await store.init();
  config.paths = { home, repos: path.join(home, "repos"), local: path.join(home, "local"), cache: path.join(home, "cache"), skills: path.join(home, "skills") };
  config.sources = [];
  config.agents = {};
  await store.write(config);
  return { store, indexStore, stateStore };
}

async function writeSkill(dir: string, name: string, description?: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const front = description ? `---\nname: ${name}\ndescription: ${description}\n---\n` : `---\nname: ${name}\n---\n`;
  await fs.writeFile(path.join(dir, "SKILL.md"), `${front}body\n`, "utf8");
}

describe("asm skill search (CLI format + filtering)", () => {
  test("search + formatSkillRows produces list-aligned rows", async () => {
    const { store, indexStore, stateStore } = await setupHome();
    const reactDir = path.join(await tempDir("asm-s-react-"), "react-helper");
    const reactSrc = path.join(await tempDir("asm-s-react-src-"), "react-core");
    const backendDir = path.join(await tempDir("asm-s-backend-"), "backend-tools");
    await writeSkill(reactDir, "react-helper", "UI components");
    await writeSkill(reactSrc, "react-core", "core react skill");
    await writeSkill(backendDir, "backend-tools", "server utils");
    await addSource(store, stateStore, path.dirname(reactDir));
    await addSource(store, stateStore, path.dirname(reactSrc));
    await addSource(store, stateStore, path.dirname(backendDir));
    const index = await refreshIndex(await store.read(), await stateStore.read());
    await indexStore.write(index);

    // 未 installed 的 configured-source 候选归 discovered（"可纳管"）。
    // R2：formatSkillRows 现输出「表头 + 分隔线 + 固定列宽行」（表头走 i18n 字典）。
    const reactRows = formatSkillRows(searchSkills(index, "react"), "en");
    expect(reactRows[0]).toMatch(/^NAME\s/); // 英文表头
    expect(reactRows[1]).toMatch(/^─+$/); // 分隔线
    const reactCore = reactRows.find((row) => row.startsWith("react-core"));
    const reactHelper = reactRows.find((row) => row.startsWith("react-helper"));
    expect(reactCore).toBeDefined();
    expect(reactCore!).toContain("discovered");
    expect(reactCore!).toContain("core react skill");
    expect(reactHelper).toBeDefined();
    expect(reactHelper!).toContain("discovered");
    expect(reactHelper!).toContain("UI components");

    // 空关键字返回全部，按 name 排序（跳过表头 + 分隔线）。
    const allRows = formatSkillRows(searchSkills(index, ""), "en");
    const dataRows = allRows.slice(2);
    expect(dataRows.map((row) => row.split(/\s+/)[0])).toEqual(["backend-tools", "react-core", "react-helper"]);
  });

  test("中文表头在固定 widths 下稳定对齐（中文更窄不溢出）", async () => {
    const { store, indexStore, stateStore } = await setupHome();
    const dir = path.join(await tempDir("asm-s-zh-"), "zh-skill");
    await writeSkill(dir, "zh-skill", "测试技能");
    await addSource(store, stateStore, path.dirname(dir));
    const index = await refreshIndex(await store.read(), await stateStore.read());
    await indexStore.write(index);

    const zhRows = formatSkillRows(searchSkills(index, "zh"), "zh-CN");
    expect(zhRows[0]).toMatch(/^名称\s/); // 中文表头
    expect(zhRows[1]).toMatch(/^─+$/); // 分隔线宽度与英文一致（widths 固定）
    // 中英文分隔线宽度相同（均来自固定 widths [24,11,18,48] 之和），证明列宽不随语言漂移。
    const enRows = formatSkillRows(searchSkills(index, "zh"), "en");
    expect(zhRows[1]).toBe(enRows[1]);
    expect(zhRows[1].length).toBe(enRows[1].length);
  });
});

describe("asm tui lazy import", () => {
  test("App module resolves and exports a renderable component", async () => {
    const mod = await import("../src/tui/App.js");
    expect(typeof mod.App).toBe("function");
  });
});
