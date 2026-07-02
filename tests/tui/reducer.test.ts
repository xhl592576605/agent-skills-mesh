import { describe, expect, test } from "vitest";
import type { AppConfig } from "../../src/core/models/config.js";
import type { IndexFile } from "../../src/core/models/index.js";
import type { InstallationRecord, InstallationStatus } from "../../src/core/models/installation.js";
import type { SkillRecord } from "../../src/core/models/skill.js";
import { createInitialState, reducer } from "../../src/tui/state/reducer.js";
import type { TuiSnapshot, TuiState } from "../../src/tui/state/types.js";

// ---- fixtures --------------------------------------------------------------

function makeConfig(): AppConfig {
  return {
    version: 1,
    settings: { install_strategy: "symlink", default_agent: "pi", auto_refresh_on_start: true },
    paths: { home: "", repos: "", local: "", cache: "" },
    sources: [],
    // gemini disabled：验证它不出现在 Matrix 列维度，且 BATCH_ROW 不触碰它。
    agents: {
      claude: { name: "Claude", enabled: true, skills_dir: "" },
      codex: { name: "Codex", enabled: true, skills_dir: "" },
      pi: { name: "Pi", enabled: true, skills_dir: "" },
      gemini: { name: "Gemini", enabled: false, skills_dir: "" }
    },
    skillOverrides: {}
  };
}

function makeSkill(name: string): SkillRecord {
  return { name, displayName: name, tags: [], status: "managed", candidates: [] };
}

function install(skillName: string, agentId: string, status: InstallationStatus): InstallationRecord {
  return { id: `${skillName}:${agentId}`, skillName, agentId, status, targetPath: `/${agentId}/${skillName}` };
}

function makeIndex(): IndexFile {
  return {
    version: 1,
    updatedAt: "2026-07-02T00:00:00.000Z",
    sources: {},
    skills: {
      gamma: makeSkill("gamma"),
      alpha: makeSkill("alpha"),
      beta: makeSkill("beta")
    },
    installations: {
      // alpha：claude installed / codex available / pi unsupported（不可 toggle）
      "alpha:claude": install("alpha", "claude", "installed"),
      "alpha:codex": install("alpha", "codex", "available"),
      "alpha:pi": install("alpha", "pi", "unsupported"),
      // beta：claude available / codex installed / pi installed
      "beta:claude": install("beta", "claude", "available"),
      "beta:codex": install("beta", "codex", "installed"),
      "beta:pi": install("beta", "pi", "installed"),
      // gamma：claude available / codex available / pi installed
      "gamma:claude": install("gamma", "claude", "available"),
      "gamma:codex": install("gamma", "codex", "available"),
      "gamma:pi": install("gamma", "pi", "installed")
    },
    issues: []
  };
}

function makeSnapshot(): TuiSnapshot {
  return { config: makeConfig(), index: makeIndex() };
}

/** 行 [alpha, beta, gamma]；列 [claude, codex, pi]（gemini disabled 不在）。 */
function stateWithSnapshot(): TuiState {
  return { ...createInitialState(), snapshot: makeSnapshot() };
}

// ---- TOGGLE_PENDING --------------------------------------------------------

describe("reducer TOGGLE_PENDING", () => {
  test("available → install intent", () => {
    const next = reducer(stateWithSnapshot(), { type: "TOGGLE_PENDING", skillName: "alpha", agentId: "codex" });
    expect(next.pending.get("alpha")?.get("codex")).toBe("install");
  });

  test("installed → uninstall intent", () => {
    const next = reducer(stateWithSnapshot(), { type: "TOGGLE_PENDING", skillName: "alpha", agentId: "claude" });
    expect(next.pending.get("alpha")?.get("claude")).toBe("uninstall");
  });

  test("toggling again cancels the pending entry", () => {
    let state = stateWithSnapshot();
    // 先给 alpha 攒两个 pending，再取消其中一个，单独验证单 entry 取消
    // （取消最后一个 entry 删除外层 key 的行为由下一个测试覆盖）。
    state = reducer(state, { type: "TOGGLE_PENDING", skillName: "alpha", agentId: "codex" });
    state = reducer(state, { type: "TOGGLE_PENDING", skillName: "alpha", agentId: "claude" });
    state = reducer(state, { type: "TOGGLE_PENDING", skillName: "alpha", agentId: "codex" });
    expect(state.pending.get("alpha")?.has("codex")).toBe(false);
    expect(state.pending.get("alpha")?.get("claude")).toBe("uninstall");
  });

  test("canceling the last entry of a skill removes the outer key", () => {
    let state = stateWithSnapshot();
    state = reducer(state, { type: "TOGGLE_PENDING", skillName: "alpha", agentId: "codex" });
    expect(state.pending.has("alpha")).toBe(true);
    state = reducer(state, { type: "TOGGLE_PENDING", skillName: "alpha", agentId: "codex" });
    expect(state.pending.has("alpha")).toBe(false);
  });

  test("unsupported cell is ignored", () => {
    const before = stateWithSnapshot();
    const next = reducer(before, { type: "TOGGLE_PENDING", skillName: "alpha", agentId: "pi" });
    expect(next).toBe(before);
    expect(next.pending.size).toBe(0);
  });

  test("toggle is a no-op when snapshot is null", () => {
    const state = createInitialState();
    expect(reducer(state, { type: "TOGGLE_PENDING", skillName: "alpha", agentId: "codex" })).toBe(state);
  });
});

// ---- BATCH_ROW -------------------------------------------------------------

describe("reducer BATCH_ROW", () => {
  test("install intent is written for every enabled agent", () => {
    const next = reducer(stateWithSnapshot(), { type: "BATCH_ROW", skillName: "beta", intent: "install" });
    const inner = next.pending.get("beta");
    expect(inner?.get("claude")).toBe("install");
    expect(inner?.get("codex")).toBe("install");
    expect(inner?.get("pi")).toBe("install");
    // gemini disabled → 不被触碰。
    expect(inner?.has("gemini")).toBe(false);
  });

  test("uninstall intent overwrites a previous install intent", () => {
    let state = stateWithSnapshot();
    state = reducer(state, { type: "BATCH_ROW", skillName: "beta", intent: "install" });
    state = reducer(state, { type: "BATCH_ROW", skillName: "beta", intent: "uninstall" });
    const inner = state.pending.get("beta");
    expect([...(inner?.values() ?? [])]).toEqual(["uninstall", "uninstall", "uninstall"]);
  });

  test("preserves existing pending for other skills", () => {
    let state = stateWithSnapshot();
    state = reducer(state, { type: "TOGGLE_PENDING", skillName: "alpha", agentId: "codex" });
    state = reducer(state, { type: "BATCH_ROW", skillName: "beta", intent: "install" });
    expect(state.pending.get("alpha")?.get("codex")).toBe("install");
    expect(state.pending.get("beta")?.get("claude")).toBe("install");
  });
});

// ---- MOVE_CURSOR -----------------------------------------------------------

describe("reducer MOVE_CURSOR", () => {
  test("moves within bounds", () => {
    let state = stateWithSnapshot();
    state = reducer(state, { type: "MOVE_CURSOR", direction: "down" });
    expect(state.matrixCursor).toEqual({ row: 1, col: 0 });
    state = reducer(state, { type: "MOVE_CURSOR", direction: "right" });
    expect(state.matrixCursor).toEqual({ row: 1, col: 1 });
  });

  test("clamps at top edge", () => {
    let state = stateWithSnapshot();
    state = reducer(state, { type: "MOVE_CURSOR", direction: "up" });
    expect(state.matrixCursor.row).toBe(0);
    state = reducer(state, { type: "MOVE_CURSOR", direction: "left" });
    expect(state.matrixCursor.col).toBe(0);
  });

  test("clamps at bottom/right edges", () => {
    let state = stateWithSnapshot();
    state = reducer(state, { type: "MOVE_CURSOR", direction: "down" });
    state = reducer(state, { type: "MOVE_CURSOR", direction: "down" });
    state = reducer(state, { type: "MOVE_CURSOR", direction: "down" });
    state = reducer(state, { type: "MOVE_CURSOR", direction: "down" });
    state = reducer(state, { type: "MOVE_CURSOR", direction: "right" });
    state = reducer(state, { type: "MOVE_CURSOR", direction: "right" });
    state = reducer(state, { type: "MOVE_CURSOR", direction: "right" });
    // 行 [alpha,beta,gamma] → max row index 2；列 [claude,codex,pi] → max col index 2。
    expect(state.matrixCursor).toEqual({ row: 2, col: 2 });
  });

  test("no-op when snapshot is null", () => {
    const state = createInitialState();
    expect(reducer(state, { type: "MOVE_CURSOR", direction: "down" })).toBe(state);
  });
});

// ---- SET_CURSOR / SET_FOCUS_SKILL / SET_SCREEN -----------------------------

describe("reducer SET_FOCUS_SKILL + SET_CURSOR + SET_SCREEN", () => {
  test("focus skill locates the cursor on its sorted row", () => {
    // beta 排序后为第 1 行。
    const next = reducer(stateWithSnapshot(), { type: "SET_FOCUS_SKILL", skillName: "beta" });
    expect(next.focusSkill).toBe("beta");
    expect(next.matrixCursor.row).toBe(1);
  });

  test("focus skill clamps column to enabled columns", () => {
    let state = stateWithSnapshot();
    state = reducer(state, { type: "SET_CURSOR", row: 0, col: 9 });
    state = reducer(state, { type: "SET_FOCUS_SKILL", skillName: "alpha" });
    expect(state.matrixCursor).toEqual({ row: 0, col: 2 });
  });

  test("unknown focus skill still records it without moving cursor", () => {
    const before = stateWithSnapshot();
    const next = reducer(before, { type: "SET_FOCUS_SKILL", skillName: "nope" });
    expect(next.focusSkill).toBe("nope");
    expect(next.matrixCursor).toEqual(before.matrixCursor);
  });

  test("null focus skill clears focus only", () => {
    const next = reducer(stateWithSnapshot(), { type: "SET_FOCUS_SKILL", skillName: null });
    expect(next.focusSkill).toBeNull();
  });

  test("SET_CURSOR clamps out-of-range values", () => {
    const next = reducer(stateWithSnapshot(), { type: "SET_CURSOR", row: 99, col: 99 });
    expect(next.matrixCursor).toEqual({ row: 2, col: 2 });
  });

  test("SET_SCREEN switches active screen", () => {
    const next = reducer(stateWithSnapshot(), { type: "SET_SCREEN", screen: "doctor" });
    expect(next.activeScreen).toBe("doctor");
  });
});

// ---- SET_SNAPSHOT / CLEAR_PENDING / SET_LAST_RESULT / SET_BUSY -------------

describe("reducer snapshot & misc actions", () => {
  test("SET_SNAPSHOT clamps existing cursor into new dimensions", () => {
    let state = stateWithSnapshot();
    state = reducer(state, { type: "SET_CURSOR", row: 2, col: 2 });
    // 新 snapshot 只有一个 skill + 一个 enabled agent。
    const smaller: TuiSnapshot = {
      config: { ...makeConfig(), agents: { claude: { name: "Claude", enabled: true, skills_dir: "" } } },
      index: { ...makeIndex(), skills: { only: makeSkill("only") }, installations: {} }
    };
    state = reducer(state, { type: "SET_SNAPSHOT", snapshot: smaller });
    expect(state.snapshot).toBe(smaller);
    expect(state.matrixCursor).toEqual({ row: 0, col: 0 });
  });

  test("CLEAR_PENDING empties the pending map with a new reference", () => {
    let state = stateWithSnapshot();
    state = reducer(state, { type: "TOGGLE_PENDING", skillName: "alpha", agentId: "codex" });
    expect(state.pending.size).toBe(1);
    state = reducer(state, { type: "CLEAR_PENDING" });
    expect(state.pending.size).toBe(0);
  });

  test("SET_LAST_RESULT stores the apply summary", () => {
    const next = reducer(stateWithSnapshot(), { type: "SET_LAST_RESULT", result: { applied: 3, skipped: 1 } });
    expect(next.lastResult).toEqual({ applied: 3, skipped: 1 });
  });

  test("SET_BUSY toggles busy flag", () => {
    const next = reducer(stateWithSnapshot(), { type: "SET_BUSY", busy: true });
    expect(next.busy).toBe(true);
  });
});

// ---- immutability ----------------------------------------------------------

describe("reducer immutability", () => {
  test("pending actions return a new pending Map reference", () => {
    const state = stateWithSnapshot();
    const next = reducer(state, { type: "TOGGLE_PENDING", skillName: "alpha", agentId: "codex" });
    expect(next.pending).not.toBe(state.pending);
    expect(next.pending.get("alpha")).not.toBe(state.pending.get("alpha"));
  });

  test("non-pending actions preserve the pending Map reference", () => {
    const state = stateWithSnapshot();
    const next = reducer(state, { type: "SET_SCREEN", screen: "discover" });
    expect(next.pending).toBe(state.pending);
  });

  test("toggling one skill does not mutate another skill's inner map", () => {
    let state = stateWithSnapshot();
    state = reducer(state, { type: "TOGGLE_PENDING", skillName: "alpha", agentId: "codex" });
    const alphaBefore = state.pending.get("alpha");
    state = reducer(state, { type: "TOGGLE_PENDING", skillName: "beta", agentId: "claude" });
    // alpha 的内层 Map 引用应保持不变（未被 beta 的 toggle 改写）。
    expect(state.pending.get("alpha")).toBe(alphaBefore);
  });
});
