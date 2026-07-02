import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { useCallback, useReducer } from "react";
import type { ReactElement } from "react";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, test } from "vitest";
import type { AppConfig } from "../../src/core/models/config.js";
import type { IndexFile } from "../../src/core/models/index.js";
import type { InstallationRecord } from "../../src/core/models/installation.js";
import type { SkillCandidate, SkillRecord } from "../../src/core/models/skill.js";
import { refreshIndex } from "../../src/core/services/refresh-service.js";
import { ConfigStore } from "../../src/core/storage/config-store.js";
import { IndexStore } from "../../src/core/storage/index-store.js";
import { DoctorScreen } from "../../src/tui/screens/DoctorScreen.js";
import { createInitialState, reducer } from "../../src/tui/state/reducer.js";

// ---- helpers ---------------------------------------------------------------

const flush = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function candidate(skillName: string, skillPath: string): SkillCandidate {
  return {
    id: `s:${skillName}:hash`,
    skillName,
    sourceId: "s",
    sourceType: "local-dir",
    path: skillPath,
    entry: "SKILL.md",
    tags: [],
    hash: "hash",
    mtimeMs: 1,
    size: 1,
    origin: "configured-source",
    managed: true
  };
}

function skillRecord(name: string, skillPath: string): SkillRecord {
  return { name, displayName: name, status: "managed", tags: [], candidates: [candidate(name, skillPath)] };
}

function installation(record: Partial<InstallationRecord> & Pick<InstallationRecord, "skillName" | "agentId" | "status" | "targetPath">): InstallationRecord {
  return { id: `${record.skillName}:${record.agentId}`, ...record };
}

/**
 * 搭建真实 ASM_HOME：写 config（1 个存在的 source + 1 个 enabled agent）+ index。
 * index 由调用方传入，便于构造 broken-link / conflict 等检查项。
 */
async function setupHome(index: IndexFile): Promise<{ home: string; config: AppConfig; configStore: ConfigStore; indexStore: IndexStore }> {
  const home = await tempDir("asm-tui-doc-home-");
  process.env.ASM_HOME = home;
  const sourceDir = path.join(home, "src");
  const agentDir = path.join(home, "pi-skills");
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.mkdir(agentDir, { recursive: true });

  const configStore = new ConfigStore(home);
  const indexStore = new IndexStore(home);
  const config = await configStore.init();
  config.sources = [{ id: "s", name: "Src", type: "local-dir", path: sourceDir, enabled: true, readonly: false }];
  config.agents = { pi: { name: "Pi", enabled: true, skills_dir: agentDir } };
  config.skillOverrides = {};
  await configStore.write(config);
  await indexStore.write(index);
  return { home, config, configStore, indexStore };
}

function DoctorHarness({
  config,
  index,
  refresh
}: {
  config: AppConfig;
  index: IndexFile;
  refresh: () => Promise<IndexFile>;
}): ReactElement {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    ...createInitialState(),
    snapshot: { config, index }
  }));
  return <DoctorScreen state={state} dispatch={dispatch} refresh={refresh} />;
}

const originalHome = process.env.ASM_HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASM_HOME;
  else process.env.ASM_HOME = originalHome;
});

// ---- rendering: [f] only on fixable checks --------------------------------

describe("DoctorScreen rendering", () => {
  test("shows [f] fix only on fixable checks (broken-link), not on conflict", async () => {
    const agentDir = "/tmp/asm-doctor-agent-render"; // 仅用于 targetPath 文本，runDoctor 不校验该路径
    const sourceDir = "/tmp/asm-doctor-src-render";
    const index: IndexFile = {
      version: 1,
      updatedAt: "2026-07-02T00:00:00.000Z",
      sources: {},
      skills: {
        broken: skillRecord("broken", path.join(sourceDir, "broken")),
        conflict: skillRecord("conflict", path.join(sourceDir, "conflict"))
      },
      installations: {
        "broken:pi": installation({ skillName: "broken", agentId: "pi", status: "broken-link", targetPath: path.join(agentDir, "broken"), linkTarget: "/tmp/missing", reason: "symlink target is missing" }),
        "conflict:pi": installation({ skillName: "conflict", agentId: "pi", status: "conflict", targetPath: path.join(agentDir, "conflict"), reason: "symlink points to another candidate" })
      },
      issues: []
    };
    const { config } = await setupHome(index);

    const refresh = async (): Promise<IndexFile> => index;
    const { lastFrame } = render(<DoctorHarness config={config} index={index} refresh={refresh} />);
    await flush();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("broken-link");
    expect(frame).toContain("conflict");
    expect(frame).toContain("[f] fix");
    // 仅可修复项带 [f]；conflict 项不可修复（无 fix），不应为其显示 [f]。
    // 断言：包含 broken-link 行且该行含 [f]；含 conflict 行。
    const lines = frame.split("\n");
    const brokenLine = lines.find((line) => line.includes("broken-link"));
    const conflictLine = lines.find((line) => line.includes("conflict") && !line.includes("broken"));
    expect(brokenLine).toBeDefined();
    expect(brokenLine).toContain("[f]");
    expect(conflictLine).toBeDefined();
    expect(conflictLine).not.toContain("[f]");
  });
});

// ---- fix flow: confirmation + real repair ----------------------------------

describe("DoctorScreen fix (real services)", () => {
  test("f then y repairs a broken symlink and the check clears after refresh", async () => {
    // 真实可修复场景：source 存在、agent 目录下有一个断链 symlink。
    const home = await tempDir("asm-tui-doc-fix-");
    process.env.ASM_HOME = home;
    const sourceDir = path.join(home, "src");
    const agentDir = path.join(home, "pi-skills");
    const skillDir = path.join(sourceDir, "foo");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# foo");
    await fs.mkdir(agentDir, { recursive: true });
    // 断链：agentDir/foo -> 不存在的目标。
    const brokenTarget = path.join(agentDir, "foo");
    await fs.symlink(path.join(home, "missing"), brokenTarget, "dir");

    const configStore = new ConfigStore(home);
    const indexStore = new IndexStore(home);
    const config = await configStore.init();
    config.sources = [{ id: "s", name: "Src", type: "local-dir", path: sourceDir, enabled: true, readonly: false }];
    config.agents = { pi: { name: "Pi", enabled: true, skills_dir: agentDir } };
    config.skillOverrides = {};
    await configStore.write(config);

    const index: IndexFile = {
      version: 1,
      updatedAt: "2026-07-02T00:00:00.000Z",
      sources: {},
      skills: { foo: skillRecord("foo", skillDir) },
      installations: {
        "foo:pi": installation({ skillName: "foo", agentId: "pi", status: "broken-link", targetPath: brokenTarget, linkTarget: path.join(home, "missing"), reason: "symlink target is missing" })
      },
      issues: []
    };
    await indexStore.write(index);

    function IntegrationHarness(): ReactElement {
      const [state, dispatch] = useReducer(reducer, undefined, () => ({
        ...createInitialState(),
        snapshot: { config, index }
      }));
      const refresh = useCallback(async () => {
        const next = await refreshIndex(config, await indexStore.read());
        await indexStore.write(next);
        dispatch({ type: "SET_SNAPSHOT", snapshot: { config, index: next } });
        return next;
      }, []);
      return <DoctorScreen state={state} dispatch={dispatch} refresh={refresh} />;
    }

    const { stdin, lastFrame, unmount } = render(<IntegrationHarness />);
    await flush();
    // 初始：doctor 检出 broken-link（带 [f]）。
    expect(lastFrame() ?? "").toContain("broken-link");
    expect(lastFrame() ?? "").toContain("[f] fix");

    // 光标初始在 config 检查项（无 fix）；依次下移到 broken-link 检查项
    // （顺序：config, index, source, agent-dir, broken-link）。
    for (let i = 0; i < 4; i++) stdin.write("\u001b[B");
    await flush();

    stdin.write("f"); // 选中修复 → 弹出二次确认框
    await flush();
    const confirmFrame = lastFrame() ?? "";
    expect(confirmFrame).toContain("Apply fix?");
    expect(confirmFrame).toContain("repair symlink");
    expect(confirmFrame).toContain("[y] apply");

    stdin.write("y"); // 确认 → executeFix(repair) + refresh
    await flush(80);

    // 真实 repair：断链被重建为指向 source 的有效 symlink。
    const stat = await fs.lstat(brokenTarget);
    expect(stat.isSymbolicLink()).toBe(true);
    expect(path.resolve(path.dirname(brokenTarget), await fs.readlink(brokenTarget))).toBe(skillDir);
    // refresh 后 installation 转 installed → broken-link 检查项消失。
    expect(lastFrame() ?? "").not.toContain("broken-link");
    unmount();
  });

  test("f then n cancels without modifying the filesystem", async () => {
    const home = await tempDir("asm-tui-doc-cancel-");
    process.env.ASM_HOME = home;
    const sourceDir = path.join(home, "src");
    const agentDir = path.join(home, "pi-skills");
    const skillDir = path.join(sourceDir, "foo");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# foo");
    await fs.mkdir(agentDir, { recursive: true });
    const brokenTarget = path.join(agentDir, "foo");
    await fs.symlink(path.join(home, "missing"), brokenTarget, "dir");

    const configStore = new ConfigStore(home);
    const indexStore = new IndexStore(home);
    const config = await configStore.init();
    config.sources = [{ id: "s", name: "Src", type: "local-dir", path: sourceDir, enabled: true, readonly: false }];
    config.agents = { pi: { name: "Pi", enabled: true, skills_dir: agentDir } };
    config.skillOverrides = {};
    await configStore.write(config);

    const index: IndexFile = {
      version: 1,
      updatedAt: "2026-07-02T00:00:00.000Z",
      sources: {},
      skills: { foo: skillRecord("foo", skillDir) },
      installations: {
        "foo:pi": installation({ skillName: "foo", agentId: "pi", status: "broken-link", targetPath: brokenTarget, linkTarget: path.join(home, "missing"), reason: "symlink target is missing" })
      },
      issues: []
    };
    await indexStore.write(index);

    function CancelHarness(): ReactElement {
      const [state, dispatch] = useReducer(reducer, undefined, () => ({
        ...createInitialState(),
        snapshot: { config, index }
      }));
      const refresh = useCallback(async () => {
        const next = await refreshIndex(config, await indexStore.read());
        await indexStore.write(next);
        dispatch({ type: "SET_SNAPSHOT", snapshot: { config, index: next } });
        return next;
      }, []);
      return <DoctorScreen state={state} dispatch={dispatch} refresh={refresh} />;
    }

    const { stdin, lastFrame, unmount } = render(<CancelHarness />);
    await flush();
    // 下移到 broken-link 检查项。
    for (let i = 0; i < 4; i++) stdin.write("\u001b[B");
    await flush();
    stdin.write("f");
    await flush();
    expect(lastFrame() ?? "").toContain("Apply fix?");
    stdin.write("n"); // 取消
    await flush();
    // 确认框关闭，仍停留在 doctor 屏；断链未被修复（依然指向 missing）。
    expect(lastFrame() ?? "").not.toContain("Apply fix?");
    expect(lastFrame() ?? "").toContain("broken-link");
    const linkTarget = path.resolve(path.dirname(brokenTarget), await fs.readlink(brokenTarget));
    expect(linkTarget).toBe(path.join(home, "missing"));
    unmount();
  });
});
