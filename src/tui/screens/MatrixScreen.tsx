import { useState, type Dispatch } from "react";
import { Box, Text, useInput } from "ink";
import type { ReactElement } from "react";
import type { AppConfig } from "../../core/models/config.js";
import type { IndexFile } from "../../core/models/index.js";
import { Matrix, buildAgentColumns, type MatrixAgentColumn } from "../components/Matrix.js";
import { PlanReviewModal } from "../components/PlanReviewModal.js";
import { SkillInspector } from "../components/SkillInspector.js";
import { StatusBar } from "../components/StatusBar.js";
import { useInstallPlan, type PlanReview } from "../hooks/useInstallPlan.js";
import type { TuiAction, TuiState } from "../state/types.js";

export interface MatrixScreenProps {
  readonly state: TuiState;
  readonly dispatch: Dispatch<TuiAction>;
  readonly refresh: () => Promise<IndexFile>;
}

const SCREEN_KEYS: Record<string, "matrix" | "discover" | "doctor"> = {
  "1": "matrix",
  "2": "discover",
  "3": "doctor"
};

/**
 * Matrix 屏幕容器：消费 reducer/useIndexState，收集按键意图，装配展示组件。
 *
 * 写操作安全：install/uninstall 只在 PlanReviewModal 确认（y）后经 useInstallPlan.applyAll
 * 执行；方向键/space/a/d 仅修改本地 pending（reducer，无 FS 变更）；refresh 走 store 写回。
 *
 * Hooks 顺序：`useInput` 必须无条件调用（即便 snapshot 暂未就绪），故派生值在 null
 * 安全的前提下提前计算，handler 内再 guard。
 */
export function MatrixScreen({ state, dispatch, refresh }: MatrixScreenProps): ReactElement {
  const [review, setReview] = useState<PlanReview | null>(null);
  const { buildReview, applyAll } = useInstallPlan(refresh);

  const snapshot = state.snapshot;
  const config: AppConfig | undefined = snapshot?.config;
  const index: IndexFile | undefined = snapshot?.index;
  const skills = index ? Object.values(index.skills).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const agents: MatrixAgentColumn[] = config ? buildAgentColumns(config.agents) : [];
  const enabledAgents = agents.filter((agent) => agent.enabled);
  const cursorSkill = skills[state.matrixCursor.row] ?? null;
  const cursorAgent = enabledAgents[state.matrixCursor.col] ?? null;

  const handleConfirm = async (): Promise<void> => {
    if (!review || !config || !index) return;
    setReview(null); // 关闭 modal，避免 apply 期间再触发按键。
    dispatch({ type: "SET_BUSY", busy: true });
    try {
      const outcome = await applyAll(config, index, state.pending);
      dispatch({ type: "SET_LAST_RESULT", result: { applied: outcome.applied, skipped: outcome.skipped } });
      dispatch({ type: "CLEAR_PENDING" });
    } catch {
      // apply 单条失败已在 useInstallPlan 内捕获；此处兜底，busy 在 finally 复位。
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
    }
  };

  const handleRefresh = async (): Promise<void> => {
    dispatch({ type: "SET_BUSY", busy: true });
    try {
      await refresh(); // useIndexState 更新 index → App effect 回写 SET_SNAPSHOT。
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
    }
  };

  useInput(
    (input, key) => {
      if (!config || !index) return;
      if (key.upArrow) return dispatch({ type: "MOVE_CURSOR", direction: "up" });
      if (key.downArrow) return dispatch({ type: "MOVE_CURSOR", direction: "down" });
      if (key.leftArrow) return dispatch({ type: "MOVE_CURSOR", direction: "left" });
      if (key.rightArrow) return dispatch({ type: "MOVE_CURSOR", direction: "right" });

      const lower = input.toLowerCase();
      if (input === " ") {
        if (cursorSkill && cursorAgent) dispatch({ type: "TOGGLE_PENDING", skillName: cursorSkill.name, agentId: cursorAgent.id });
        return;
      }
      if (lower === "a") {
        if (cursorSkill) dispatch({ type: "BATCH_ROW", skillName: cursorSkill.name, intent: "install" });
        return;
      }
      if (lower === "d") {
        if (cursorSkill) dispatch({ type: "BATCH_ROW", skillName: cursorSkill.name, intent: "uninstall" });
        return;
      }
      if (lower === "r") {
        void handleRefresh();
        return;
      }
      if (key.tab) {
        const order: Array<"matrix" | "discover" | "doctor"> = ["matrix", "discover", "doctor"];
        const nextIndex = (order.indexOf(state.activeScreen) + 1) % order.length;
        dispatch({ type: "SET_SCREEN", screen: order[nextIndex] });
        return;
      }
      if (SCREEN_KEYS[lower]) {
        dispatch({ type: "SET_SCREEN", screen: SCREEN_KEYS[lower] });
        return;
      }
      if (key.return) {
        if (state.pending.size === 0) return;
        void (async () => {
          dispatch({ type: "SET_BUSY", busy: true });
          try {
            const built = await buildReview(config, index, state.pending);
            setReview(built);
          } catch {
            // plan 构建失败（如 skill 已不存在）：忽略，busy 复位。
          } finally {
            dispatch({ type: "SET_BUSY", busy: false });
          }
        })();
      }
    },
    { isActive: config !== undefined && index !== undefined && review === null && !state.busy }
  );

  if (!snapshot || !config || !index) {
    return <Text dimColor>Initializing…</Text>;
  }

  return (
    <Box flexDirection="column">
      <Matrix
        skills={skills}
        agents={agents}
        installations={index.installations}
        pending={state.pending}
        cursor={state.matrixCursor}
      />
      <SkillInspector
        skill={cursorSkill}
        agents={agents}
        installations={index.installations}
        pending={state.pending}
      />
      <StatusBar busy={state.busy} lastResult={state.lastResult} pendingCount={state.pending.size} />
      {review ? (
        <PlanReviewModal
          review={review}
          onConfirm={() => void handleConfirm()}
          onCancel={() => setReview(null)}
        />
      ) : null}
    </Box>
  );
}
