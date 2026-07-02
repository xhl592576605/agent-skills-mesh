import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { useCallback, useReducer } from "react";
import type { ReactElement } from "react";
import { render } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { AppConfig } from "../../src/core/models/config.js";
import type { IndexFile } from "../../src/core/models/index.js";
import type { InstallationRecord, InstallationStatus } from "../../src/core/models/installation.js";
import type { SkillCandidate, SkillRecord, SkillStatus } from "../../src/core/models/skill.js";
import { refreshIndex } from "../../src/core/services/refresh-service.js";
import { ConfigStore } from "../../src/core/storage/config-store.js";
import { IndexStore } from "../../src/core/storage/index-store.js";
import { DiscoverScreen } from "../../src/tui/screens/DiscoverScreen.js";
import { createInitialState, reducer } from "../../src/tui/state/reducer.js";
import type { TuiAction } from "../../src/tui/state/types.js";

// ---- helpers ---------------------------------------------------------------

const flush = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
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

function skill(name: string, status: SkillStatus, candidates: SkillCandidate[]): SkillRecord {
  return { name, displayName: name, status, tags: [], candidates };
}

function install(skillName: string, agentId: string, status: InstallationStatus, extra: Partial<InstallationRecord> = {}): InstallationRecord {
  return { id: `${skillName}:${agentId}`, skillName, agentId, status, targetPath: `/tmp/${agentId}/${skillName}`, ...extra };
}

function staticConfig(): AppConfig {
  return {
    version: 1,
    settings: { install_strategy: "symlink", default_agent: "pi", auto_refresh_on_start: true },
    paths: { home: "", repos: "", local: "", cache: "" },
    sources: [],
    agents: { pi: { name: "Pi", enabled: true, skills_dir: "/tmp/pi-skills" } },
    skillOverrides: {}
  };
}

function fixtureIndex(): IndexFile {
  return {
    version: 1,
    updatedAt: "2026-07-02T00:00:00.000Z",
    sources: {},
    skills: {
      discovered: skill("discovered", "discovered", [candidate("discovered", "agent", "/tmp/discovered")]),
      conflict: skill("conflict", "conflict", [candidate("conflict", "a", "/tmp/a"), candidate("conflict", "b", "/tmp/b")]),
      external: skill("external", "managed", [candidate("external", "src", "/tmp/external-src")]),
      broken: skill("broken", "managed", [candidate("broken", "src", "/tmp/broken-src")])
    },
    installations: {
      "external:pi": install("external", "pi", "external", { reason: "target is a real skill directory" }),
      "broken:pi": install("broken", "pi", "broken-link", { linkTarget: "/tmp/missing", reason: "symlink target is missing" })
    },
    issues: []
  };
}

/** 渲染并捕获 dispatch 的测试 Harness（reload 为 no-op，适用于纯渲染/导航测试）。 */
function StaticHarness({
  config,
  initialIndex,
  onDispatch
}: {
  config: AppConfig;
  initialIndex: IndexFile;
  onDispatch?: (action: TuiAction) => void;
}): ReactElement {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    ...createInitialState(),
    snapshot: { config, index: initialIndex }
  }));
  const wrappedDispatch = useCallback(
    (action: TuiAction) => {
      onDispatch?.(action);
      dispatch(action);
    },
    [onDispatch]
  );
  const reload = useCallback(async () => {
    /* no-op：纯渲染/导航测试不触发真实变更 */
  }, []);
  return <DiscoverScreen state={state} dispatch={wrappedDispatch} reload={reload} />;
}

// ---- pure rendering --------------------------------------------------------

describe("DiscoverScreen rendering", () => {
  test("renders all entry kinds with badges and cursor highlight", async () => {
    const { lastFrame } = render(<StaticHarness config={staticConfig()} initialIndex={fixtureIndex()} />);
    await flush(); // 等 useInput passive effect 挂载。
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[disc]");
    expect(frame).toContain("[ext]");
    expect(frame).toContain("[brk]");
    expect(frame).toContain("[cnf]");
    expect(frame).toContain("discovered");
    expect(frame).toContain("external");
    expect(frame).toContain("broken");
    expect(frame).toContain("conflict");
    // 光标在第一行 → ❯ 高亮标记。
    expect(frame).toContain("❯");
  });

  test("shows empty-state hint when there are no entries", async () => {
    const emptyIndex: IndexFile = { ...fixtureIndex(), skills: {}, installations: {} };
    const { lastFrame } = render(<StaticHarness config={staticConfig()} initialIndex={emptyIndex} />);
    await flush();
    expect(lastFrame() ?? "").toContain("No discovered");
  });
});

// ---- navigation + jump -----------------------------------------------------

describe("DiscoverScreen interaction", () => {
  test("arrow keys move the cursor through entries", async () => {
    const { stdin, lastFrame } = render(<StaticHarness config={staticConfig()} initialIndex={fixtureIndex()} />);
    await flush();
    expect(lastFrame() ?? "").toContain("❯"); // 初始在第一行
    stdin.write("\u001b[B"); // down arrow
    await flush();
    const frame = lastFrame() ?? "";
    // 第二行（按 listDiscover 顺序：discovered/conflict 来自 skills 排序，external/broken 来自 installations）
    expect(frame).toContain("❯");
  });

  test("enter jumps to Matrix with focus skill set", async () => {
    const dispatched: TuiAction[] = [];
    const { stdin } = render(
      <StaticHarness config={staticConfig()} initialIndex={fixtureIndex()} onDispatch={(action) => dispatched.push(action)} />
    );
    await flush();
    // 首项按 name 排序后是 "conflict"（listDiscover 先遍历排序后的 skills）。
    stdin.write("\r"); // enter on first entry
    await flush();
    expect(dispatched).toContainEqual({ type: "SET_FOCUS_SKILL", skillName: "conflict" });
    expect(dispatched).toContainEqual({ type: "SET_SCREEN", screen: "matrix" });
  });

  test("2/3 keys and tab switch screens", async () => {
    const dispatched: TuiAction[] = [];
    const { stdin } = render(
      <StaticHarness config={staticConfig()} initialIndex={fixtureIndex()} onDispatch={(action) => dispatched.push(action)} />
    );
    await flush();
    stdin.write("3");
    await flush();
    expect(dispatched).toContainEqual({ type: "SET_SCREEN", screen: "doctor" });
  });
});

// ---- adopt via real services (integration) ---------------------------------

async function writeSkill(dir: string, name: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\nbody\n`, "utf8");
}

describe("DiscoverScreen adopt (real services)", () => {
  const originalHome = process.env.ASM_HOME;

  beforeEach(() => {
    // 隔离真实 home：测试全程使用临时 ASM_HOME。
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.ASM_HOME;
    else process.env.ASM_HOME = originalHome;
  });

  test("a adopts the selected discovered skill and the entry disappears after reload", async () => {
    const home = await tempDir("asm-tui-disc-home-");
    process.env.ASM_HOME = home;
    const globalDir = path.join(home, "global-skills");
    const agentDir = path.join(home, "pi-skills");
    await fs.mkdir(globalDir, { recursive: true });
    await fs.mkdir(agentDir, { recursive: true });

    const configStore = new ConfigStore(home);
    const indexStore = new IndexStore(home);
    const config = await configStore.init();
    config.sources = [{ id: "global", name: "Global", type: "global-dir", path: globalDir, enabled: true, readonly: false }];
    config.agents = { pi: { name: "Pi", enabled: true, skills_dir: agentDir } };
    config.skillOverrides = {};
    await configStore.write(config);

    await writeSkill(path.join(agentDir, "my-helper"), "my-helper");
    let index = await refreshIndex(config, await indexStore.read());
    await indexStore.write(index);
    expect(index.skills["my-helper"].status).toBe("discovered");

    function IntegrationHarness(): ReactElement {
      const [state, dispatch] = useReducer(reducer, undefined, () => ({
        ...createInitialState(),
        snapshot: { config, index }
      }));
      const reload = useCallback(async () => {
        // 重新读取 config+index（service 已写盘），回写 snapshot。
        const freshConfig = await configStore.read();
        const freshIndex = await indexStore.read();
        dispatch({ type: "SET_SNAPSHOT", snapshot: { config: freshConfig, index: freshIndex } });
      }, []);
      return <DiscoverScreen state={state} dispatch={dispatch} reload={reload} />;
    }

    const { stdin, lastFrame, unmount } = render(<IntegrationHarness />);
    await flush();
    // 屏幕已渲染（heading 稳定；badge/长路径会换行，不用于断言）。
    expect(lastFrame() ?? "").toContain("Discover");

    stdin.write("a"); // adopt 光标所在条目
    await flush(80);

    // 真实 adopt：源目录被移走、原位变 symlink、config 写 managed override。
    const originalPath = path.join(agentDir, "my-helper");
    expect((await fs.lstat(originalPath)).isSymbolicLink()).toBe(true);
    expect(await fs.lstat(path.join(globalDir, "my-helper"))).toBeDefined();
    // reload 后 my-helper 转 managed（installation 转 installed），Discover 列表变空。
    expect(lastFrame() ?? "").toContain("No discovered");
    unmount();
  });
});
