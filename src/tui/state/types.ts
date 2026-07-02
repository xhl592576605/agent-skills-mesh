import type { AppConfig } from "../../core/models/config.js";
import type { IndexFile } from "../../core/models/index.js";

/**
 * TUI 本地状态类型（.ts，无 JSX）。
 *
 * 这些类型只描述「展示/交互状态」，不复制域数据：snapshot 直接复用
 * `AppConfig` / `IndexFile`，pending 是 UI 层未提交的安装意图。
 * 域规则（扫描/plan/apply）仍留在 `src/core/services/**`。
 */

/** 当前已加载的配置 + 索引快照，作为矩阵/Discover/Doctor 的数据源。 */
export interface TuiSnapshot {
  config: AppConfig;
  index: IndexFile;
}

/** 单格 pending 意图：安装或卸载。 */
export type PendingIntent = "install" | "uninstall";

/** Matrix / Discover / Doctor 三屏。 */
export type TuiScreen = "matrix" | "discover" | "doctor";

/** 方向键四向。 */
export type CursorDirection = "up" | "down" | "left" | "right";

/** Matrix 光标位置（行/列索引，0-based）。 */
export interface MatrixCursor {
  row: number;
  col: number;
}

/** 一次批量 apply 的汇总结果。 */
export interface ApplyResult {
  applied: number;
  skipped: number;
}

/**
 * TUI 顶层状态容器（design「全局状态容器」）。
 * 纯数据，由 reducer 演进；副作用（service 调用）不进 reducer。
 */
export interface TuiState {
  snapshot: TuiSnapshot | null;
  activeScreen: TuiScreen;
  matrixCursor: MatrixCursor;
  /** skillName → agentId → intent。每次更新返回新 Map（不可变）。 */
  pending: Map<string, Map<string, PendingIntent>>;
  /** Discover→Matrix 跳转定位用。 */
  focusSkill: string | null;
  /** apply / refresh 进行中。 */
  busy: boolean;
  lastResult: ApplyResult | null;
}

/**
 * Reducer action 联合。每个 action 表达一个用户意图或外部事件，
 * 不携带域计算结果（plan 由 service 层构建）。
 */
export type TuiAction =
  | { type: "SET_SNAPSHOT"; snapshot: TuiSnapshot }
  | { type: "SET_SCREEN"; screen: TuiScreen }
  | { type: "MOVE_CURSOR"; direction: CursorDirection }
  | { type: "SET_CURSOR"; row: number; col: number }
  | { type: "TOGGLE_PENDING"; skillName: string; agentId: string }
  | { type: "BATCH_ROW"; skillName: string; intent: PendingIntent }
  | { type: "SET_FOCUS_SKILL"; skillName: string | null }
  | { type: "SET_BUSY"; busy: boolean }
  | { type: "SET_LAST_RESULT"; result: ApplyResult | null }
  | { type: "CLEAR_PENDING" };
