import { useReducer, type Dispatch } from "react";
import { createInitialState, reducer } from "../state/reducer.js";
import type { TuiAction, TuiState } from "../state/types.js";

export interface UseTuiAppResult {
  state: TuiState;
  dispatch: Dispatch<TuiAction>;
}

/**
 * 顶层 reducer 装配（.ts，无 JSX）。
 *
 * Phase C 只做纯装配：`useReducer(reducer, createInitialState)`。
 * snapshot 注入（useIndexState → SET_SNAPSHOT）留给 App.tsx（Phase D/G），
 * 本 hook 不耦合数据加载，保持可独立测试。
 */
export function useTuiApp(): UseTuiAppResult {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  return { state, dispatch };
}
