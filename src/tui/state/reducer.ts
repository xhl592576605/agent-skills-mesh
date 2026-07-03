import type { InstallationStatus } from "../../core/models/installation.js";
import type { TuiAction, TuiSnapshot, TuiState } from "./types.js";

/**
 * TUI 纯 reducer（.ts，无 JSX，无副作用）。
 *
 * 行为约束（design「状态机与数据流」「全局状态容器」）：
 * - pending 是唯一可变累积状态，每次更新返回新外层 + 新内层 Map（不可变）。
 * - TOGGLE_PENDING 的「可否 toggle」知识来自 installation status：
 *   installed→uninstall、undefined→enable，其余（conflict/external/
 *   broken-link/missing）不可 toggle（broken-link 由 Doctor 修，
 *   conflict 由 skill add --source / skill rebind 解决），与 design 状态机一致。
 * - Matrix 维度：行 = 按 name 排序的 skills；列 = enabled agents
 *   （按 config.agents 声明顺序）。disabled agent 不可达（其格本就 unsupported）。
 *   展示层是否额外渲染 disabled 列由组件决定，reducer 只按 enabled 列 clamp 光标。
 */

export function createInitialState(): TuiState {
  return {
    snapshot: null,
    activeScreen: "matrix",
    matrixCursor: { row: 0, col: 0 },
    pending: new Map(),
    focusSkill: null,
    busy: false,
    lastResult: null
  };
}

/** installation 记录在 index.installations 中的 key 格式：`skillName:agentId`（见 install-service detectInstallation）。 */
function installationKey(skillName: string, agentId: string): string {
  return `${skillName}:${agentId}`;
}

/** Matrix 维度：行 = 排序后的 skill 名；列 = enabled agent id（声明顺序）。snapshot 为空时均为空。 */
function matrixDimensions(snapshot: TuiSnapshot | null): { rows: string[]; cols: string[] } {
  if (!snapshot) return { rows: [], cols: [] };
  const rows = Object.values(snapshot.index.skills)
    .map((skill) => skill.name)
    .sort((a, b) => a.localeCompare(b));
  const cols = Object.entries(snapshot.config.agents)
    .filter(([, agent]) => agent.enabled)
    .map(([id]) => id);
  return { rows, cols };
}

/** 将索引 clamp 到 [0, max) 区间；max<=0 时归 0。 */
function clampIndex(value: number, max: number): number {
  if (max <= 0) return 0;
  if (value < 0) return 0;
  if (value >= max) return max - 1;
  return value;
}

function installationStatusOf(snapshot: TuiSnapshot | null, skillName: string, agentId: string): InstallationStatus | undefined {
  if (!snapshot) return undefined;
  return snapshot.index.installations[installationKey(skillName, agentId)]?.status;
}

/** 根据 installation status 推导单格 toggle 后的意图；不可 toggle 时返回 undefined。 */
function intentForStatus(status: InstallationStatus | undefined): "install" | "uninstall" | undefined {
  if (status === "installed") return "uninstall";
  if (status === undefined) return "install";
  return undefined;
}

export function reducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "SET_SNAPSHOT": {
      // snapshot 切换后 clamp 光标到新维度，避免 skills 减少后越界。
      const { rows, cols } = matrixDimensions(action.snapshot);
      return {
        ...state,
        snapshot: action.snapshot,
        matrixCursor: {
          row: clampIndex(state.matrixCursor.row, rows.length),
          col: clampIndex(state.matrixCursor.col, cols.length)
        }
      };
    }

    case "SET_SCREEN":
      return { ...state, activeScreen: action.screen };

    case "MOVE_CURSOR": {
      if (!state.snapshot) return state;
      const { rows, cols } = matrixDimensions(state.snapshot);
      let { row, col } = state.matrixCursor;
      switch (action.direction) {
        case "up": row -= 1; break;
        case "down": row += 1; break;
        case "left": col -= 1; break;
        case "right": col += 1; break;
      }
      return { ...state, matrixCursor: { row: clampIndex(row, rows.length), col: clampIndex(col, cols.length) } };
    }

    case "SET_CURSOR": {
      if (!state.snapshot) return state;
      const { rows, cols } = matrixDimensions(state.snapshot);
      return {
        ...state,
        matrixCursor: { row: clampIndex(action.row, rows.length), col: clampIndex(action.col, cols.length) }
      };
    }

    case "TOGGLE_PENDING": {
      if (!state.snapshot) return state;
      const { skillName, agentId } = action;
      const outer = state.pending;
      const inner = outer.get(skillName);

      // 已有意图 → 再次 toggle 取消该格（删除内层 entry；内层空则移除外层 key）。
      if (inner?.has(agentId)) {
        const newOuter = new Map(outer);
        const newInner = new Map(inner);
        newInner.delete(agentId);
        if (newInner.size === 0) newOuter.delete(skillName);
        else newOuter.set(skillName, newInner);
        return { ...state, pending: newOuter };
      }

      const intent = intentForStatus(installationStatusOf(state.snapshot, skillName, agentId));
      if (!intent) return state; // conflict/external/broken-link/missing：不可 toggle。

      const newOuter = new Map(outer);
      newOuter.set(skillName, new Map([...(inner ?? []), [agentId, intent]]));
      return { ...state, pending: newOuter };
    }

    case "BATCH_ROW": {
      if (!state.snapshot) return state;
      const { skillName, intent } = action;
      // 对该 skill 的所有 enabled agent 写 intent（覆盖）；disabled agent 不动。
      const enabledAgents = Object.entries(state.snapshot.config.agents).filter(([, agent]) => agent.enabled);
      if (enabledAgents.length === 0) return state;
      const newOuter = new Map(state.pending);
      const newInner = new Map(newOuter.get(skillName) ?? []);
      for (const [agentId] of enabledAgents) newInner.set(agentId, intent);
      newOuter.set(skillName, newInner);
      return { ...state, pending: newOuter };
    }

    case "SET_FOCUS_SKILL": {
      const focusSkill = action.skillName;
      if (!state.snapshot || !focusSkill) return { ...state, focusSkill };
      // 跳转定位：把光标行设为该 skill 的排序索引；列保持（clamp 到 enabled 列数）。
      const { rows, cols } = matrixDimensions(state.snapshot);
      const row = rows.indexOf(focusSkill);
      if (row === -1) return { ...state, focusSkill };
      return {
        ...state,
        focusSkill,
        matrixCursor: { row, col: clampIndex(state.matrixCursor.col, cols.length) }
      };
    }

    case "SET_BUSY":
      return { ...state, busy: action.busy };

    case "SET_LAST_RESULT":
      return { ...state, lastResult: action.result };

    case "CLEAR_PENDING":
      return { ...state, pending: new Map() };

    default:
      return state;
  }
}
