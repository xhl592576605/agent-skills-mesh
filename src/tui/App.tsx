import { useEffect } from "react";
import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { Layout } from "./components/Layout.js";
import { MatrixScreen } from "./screens/MatrixScreen.js";
import { DiscoverScreen } from "./screens/DiscoverScreen.js";
import { DoctorScreen } from "./screens/DoctorScreen.js";
import { useIndexState } from "./hooks/useIndexState.js";
import { useTuiApp } from "./hooks/useTuiApp.js";
import type { TuiScreen } from "./state/types.js";

/** 各屏按键帮助（上下文相关，Layout 透传到底部帮助行）。 */
const HELP: Record<TuiScreen, string> = {
  matrix: "↑↓←→ move · space toggle · a install row · d uninstall row · enter review · r refresh · tab/1-3 screen",
  discover: "↑↓ move · a adopt · i ignore · u unignore · enter jump to matrix · tab/1-3 screen",
  doctor: "↑↓ move · f fix selected · F fix all · tab/1-3 screen"
};

/**
 * Agent Skills Mesh TUI 入口（Phase D–F 装配）。
 *
 * 数据流：useIndexState 加载 config/index（首次缺失自动 refresh）→ App effect 写
 * SET_SNAPSHOT → reducer 持有快照 → 各屏消费。Matrix 的 install/uninstall 经 refresh
 * 回写；Discover 的 adopt/ignore 经 reload 回写（config+index）；Doctor 的修复经 refresh
 * 回写并触发 useDoctor 自动重跑。三类回写都经由同一 effect 回写 snapshot（单一数据源）。
 */
export function App(): ReactElement {
  const { state, dispatch } = useTuiApp();
  const { config, index, loading, error, refresh, reload } = useIndexState();

  useEffect(() => {
    if (config && index) {
      dispatch({ type: "SET_SNAPSHOT", snapshot: { config, index } });
    }
  }, [config, index, dispatch]);

  if (loading) {
    return (
      <Layout activeScreen={state.activeScreen} help={HELP[state.activeScreen]}>
        <Text dimColor>Loading config and index…</Text>
      </Layout>
    );
  }
  if (error) {
    return (
      <Layout activeScreen={state.activeScreen} help={HELP[state.activeScreen]}>
        <Text color="red">Error: {error.message}</Text>
      </Layout>
    );
  }
  if (!state.snapshot) {
    return (
      <Layout activeScreen={state.activeScreen} help={HELP[state.activeScreen]}>
        <Text dimColor>Initializing…</Text>
      </Layout>
    );
  }

  return (
    <Layout activeScreen={state.activeScreen} help={HELP[state.activeScreen]}>
      {state.activeScreen === "matrix" ? (
        <MatrixScreen state={state} dispatch={dispatch} refresh={refresh} />
      ) : null}
      {state.activeScreen === "discover" ? (
        <DiscoverScreen state={state} dispatch={dispatch} reload={reload} />
      ) : null}
      {state.activeScreen === "doctor" ? (
        <DoctorScreen state={state} dispatch={dispatch} refresh={refresh} />
      ) : null}
    </Layout>
  );
}
