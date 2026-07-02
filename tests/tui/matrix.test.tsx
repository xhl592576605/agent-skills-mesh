import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { useCallback, useReducer } from "react";
import type { ReactElement } from "react";
import { render } from "ink-testing-library";
import { describe, expect, test } from "vitest";
import type { AppConfig } from "../../src/core/models/config.js";
import type { IndexFile } from "../../src/core/models/index.js";
import type { InstallationRecord, InstallationStatus } from "../../src/core/models/installation.js";
import type { SkillRecord } from "../../src/core/models/skill.js";
import { detectInstallations } from "../../src/core/services/install-service.js";
import { Matrix, buildAgentColumns, type MatrixAgentColumn } from "../../src/tui/components/Matrix.js";
import { MatrixScreen } from "../../src/tui/screens/MatrixScreen.js";
import { createInitialState, reducer } from "../../src/tui/state/reducer.js";
import type { PendingIntent } from "../../src/tui/state/types.js";

// ---- helpers ---------------------------------------------------------------

const flush = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function agentColumns(): MatrixAgentColumn[] {
  return [
    { id: "claude", name: "Claude", enabled: true, enabledOrdinal: 0 },
    { id: "pi", name: "Pi", enabled: true, enabledOrdinal: 1 },
    { id: "gemini", name: "Gemini", enabled: false, enabledOrdinal: -1 }
  ];
}

function skillNamed(name: string, candidatePath = "/src/" + name): SkillRecord {
  return {
    name,
    displayName: name,
    status: "managed",
    tags: [],
    candidates: [
      {
        id: `c-${name}`,
        skillName: name,
        sourceId: "s1",
        sourceType: "local-dir",
        path: candidatePath,
        entry: "SKILL.md",
        tags: [],
        hash: "h",
        mtimeMs: 1,
        size: 1,
        origin: "configured-source",
        managed: true
      }
    ]
  };
}

function install(skillName: string, agentId: string, status: InstallationStatus): InstallationRecord {
  return { id: `${skillName}:${agentId}`, skillName, agentId, status, targetPath: `/${agentId}/${skillName}` };
}

function pendingMap(entries: Array<[string, string, PendingIntent]>): Map<string, Map<string, PendingIntent>> {
  const outer = new Map<string, Map<string, PendingIntent>>();
  for (const [skill, agent, intent] of entries) {
    if (!outer.has(skill)) outer.set(skill, new Map());
    outer.get(skill)!.set(agent, intent);
  }
  return outer;
}

// ---- pure Matrix rendering -------------------------------------------------

describe("Matrix (pure)", () => {
  test("renders status symbols, cursor highlight, pending overlay, disabled column", () => {
    const skills = [skillNamed("alpha"), skillNamed("beta")];
    const installations: Record<string, InstallationRecord> = {
      "alpha:claude": install("alpha", "claude", "available"),
      "alpha:pi": install("alpha", "pi", "installed"),
      "alpha:gemini": install("alpha", "gemini", "unsupported"),
      "beta:claude": install("beta", "claude", "installed"),
      "beta:pi": install("beta", "pi", "available"),
      "beta:gemini": install("beta", "gemini", "unsupported")
    };
    const { lastFrame } = render(
      <Matrix
        skills={skills}
        agents={agentColumns()}
        installations={installations}
        pending={pendingMap([["alpha", "pi", "uninstall"]])}
        cursor={{ row: 0, col: 0 }}
      />
    );
    const frame = lastFrame() ?? "";
    // 光标格 alpha:claude(available) → [○]
    expect(frame).toContain("[○]");
    // installed 符号
    expect(frame).toContain("✓");
    // pending uninstall 叠加 ~-
    expect(frame).toContain("~-");
    // disabled agent 列仍渲染且符号 ×
    expect(frame).toContain("×");
    expect(frame).toContain("gemini");
  });

  test("shows empty-state hints when no skills / no enabled agents", () => {
    const { lastFrame } = render(
      <Matrix skills={[]} agents={[]} installations={{}} pending={new Map()} cursor={{ row: 0, col: 0 }} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No enabled agents");
    expect(frame).toContain("No skills indexed");
  });
});

// ---- MatrixScreen interaction ---------------------------------------------

function Harness({ config, initialIndex }: { config: AppConfig; initialIndex: IndexFile }): ReactElement {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    ...createInitialState(),
    snapshot: { config, index: initialIndex }
  }));
  const refresh = useCallback(async () => {
    const installations = await detectInstallations(config, initialIndex.skills);
    const next: IndexFile = { ...initialIndex, installations };
    dispatch({ type: "SET_SNAPSHOT", snapshot: { config, index: next } });
    return next;
  }, [config, initialIndex]);
  return <MatrixScreen state={state} dispatch={dispatch} refresh={refresh} />;
}

function staticConfig(): AppConfig {
  return {
    version: 1,
    settings: { install_strategy: "symlink", default_agent: "pi", auto_refresh_on_start: true },
    paths: { home: "", repos: "", local: "", cache: "" },
    sources: [],
    agents: {
      claude: { name: "Claude", enabled: true, skills_dir: "/tmp/claude-skills" },
      pi: { name: "Pi", enabled: true, skills_dir: "/tmp/pi-skills" },
      gemini: { name: "Gemini", enabled: false, skills_dir: "/tmp/gemini-skills" }
    },
    skillOverrides: {}
  };
}

function staticIndex(): IndexFile {
  return {
    version: 1,
    updatedAt: "2026-07-02T00:00:00.000Z",
    sources: {},
    skills: { alpha: skillNamed("alpha"), beta: skillNamed("beta") },
    installations: {
      "alpha:claude": install("alpha", "claude", "available"), // cursor {0,0} → 可 toggle
      "alpha:pi": install("alpha", "pi", "installed"),
      "beta:claude": install("beta", "claude", "installed"),
      "beta:pi": install("beta", "pi", "available")
    },
    issues: []
  };
}

describe("MatrixScreen interaction", () => {
  test("space toggles pending install on the cursor cell", async () => {
    const { stdin, lastFrame } = render(<Harness config={staticConfig()} initialIndex={staticIndex()} />);
    await flush(); // 等 useInput 的 passive effect 挂载后再写键。
    expect(lastFrame() ?? "").toContain("○"); // alpha:claude available
    stdin.write(" ");
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("~+"); // pending install overlay
  });

  test("enter opens the plan review modal", async () => {
    const { stdin, lastFrame } = render(<Harness config={staticConfig()} initialIndex={staticIndex()} />);
    await flush();
    stdin.write(" "); // 攒一个 pending
    await flush();
    stdin.write("\r"); // enter → buildReview → modal
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Review pending plan");
    expect(frame).toContain("[y] apply");
  });

  test("'a' batch-marks install for the whole enabled row", async () => {
    const { stdin, lastFrame } = render(<Harness config={staticConfig()} initialIndex={staticIndex()} />);
    await flush();
    // 光标在 alpha 行；alpha:claude available、alpha:pi installed（installed → 批量 install 覆盖为 install 意图）。
    stdin.write("a");
    await flush();
    const frame = lastFrame() ?? "";
    // claude available → ~+；pi installed 被覆盖为 install 意图 → ~+
    expect(frame.match(/~\+/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  test("confirm flow applies the plan via real services and refreshes the matrix", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "asm-matrix-apply-"));
    const source = await fs.mkdtemp(path.join(os.tmpdir(), "asm-matrix-src-"));
    await fs.writeFile(path.join(source, "SKILL.md"), "# skill");

    const config: AppConfig = {
      ...staticConfig(),
      agents: { pi: { name: "Pi", enabled: true, skills_dir: agentDir } }
    };
    const initialIndex: IndexFile = {
      version: 1,
      updatedAt: "2026-07-02T00:00:00.000Z",
      sources: {},
      skills: { foo: skillNamed("foo", source) },
      installations: { "foo:pi": install("foo", "pi", "available") },
      issues: []
    };

    const { stdin, lastFrame, unmount } = render(<Harness config={config} initialIndex={initialIndex} />);
    await flush();

    stdin.write(" "); // foo:pi available → pending install
    await flush();
    expect(lastFrame() ?? "").toContain("~+");

    stdin.write("\r"); // open review
    await flush();
    expect(lastFrame() ?? "").toContain("Review pending plan");

    stdin.write("y"); // confirm → apply
    await flush(60);

    // 真实 symlink 已创建（apply 经 plan 执行，非直接按键写 FS）。
    expect((await fs.lstat(path.join(agentDir, "foo"))).isSymbolicLink()).toBe(true);
    // refresh 重算 installations → foo:pi installed → 矩阵符号变 ✓。
    expect(lastFrame() ?? "").toContain("✓");
    unmount();
  });
});

// buildAgentColumns sanity: 与 reducer 的 enabled 列语义对齐。
describe("buildAgentColumns", () => {
  test("preserves order and computes enabled ordinal", () => {
    const cols = buildAgentColumns(staticConfig().agents);
    expect(cols.map((c) => c.id)).toEqual(["claude", "pi", "gemini"]);
    expect(cols[0].enabledOrdinal).toBe(0);
    expect(cols[1].enabledOrdinal).toBe(1);
    expect(cols[2].enabledOrdinal).toBe(-1);
  });
});
