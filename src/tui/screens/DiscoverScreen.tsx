import { useEffect, useState, type Dispatch } from "react";
import { Box, Text, useInput } from "ink";
import type { ReactElement } from "react";
import { createEmptyIndex } from "../../core/models/index.js";
import type { IndexFile } from "../../core/models/index.js";
import type { DiscoverEntry, DiscoverKind } from "../../core/services/discover-service.js";
import { useDiscover } from "../hooks/useDiscover.js";
import { StatusBar } from "../components/StatusBar.js";
import type { TuiAction, TuiState } from "../state/types.js";

export interface DiscoverScreenProps {
  readonly state: TuiState;
  readonly dispatch: Dispatch<TuiAction>;
  readonly reload: () => Promise<void>;
}

const SCREEN_KEYS: Record<string, "matrix" | "discover" | "doctor"> = {
  "1": "matrix",
  "2": "discover",
  "3": "doctor"
};

const SCREEN_ORDER: Array<"matrix" | "discover" | "doctor"> = ["matrix", "discover", "doctor"];

/** kind → 终端安全 badge（短标签，符号+文字双重编码，不依赖颜色）。 */
function kindBadge(kind: DiscoverKind): string {
  switch (kind) {
    case "discovered":
      return "[disc]";
    case "external":
      return "[ext]";
    case "broken-link":
      return "[brk]";
    case "conflict":
      return "[cnf]";
  }
}

function DiscoverRow({
  entry,
  selected,
  index
}: {
  readonly entry: DiscoverEntry;
  readonly selected: boolean;
  readonly index: number;
}): ReactElement {
  return (
    <Box>
      <Text dimColor>{String(index + 1).padStart(2)} </Text>
      <Text bold={selected} color={selected ? "cyan" : undefined}>
        {selected ? "❯ " : "  "}
        {kindBadge(entry.kind)}
      </Text>
      <Text bold={selected}> {entry.skillName}</Text>
      <Text dimColor> {entry.detail}</Text>
    </Box>
  );
}

/**
 * Discover 屏幕：渲染 listDiscover 条目，收集 adopt/ignore/跳转 意图。
 *
 * 写操作安全：adopt/ignore 只在按键确认后经 useDiscover（→ service 写 config+index）执行，
 * 不直接改文件系统；完成后 reload 让 App 回写 snapshot、各屏重算。
 *
 * `useInput` 必须无条件调用，故 hook 用空 index 兜底（App 仅在 snapshot 就绪时渲染本屏）。
 */
export function DiscoverScreen({ state, dispatch, reload }: DiscoverScreenProps): ReactElement {
  const index: IndexFile = state.snapshot?.index ?? createEmptyIndex();
  const { entries, adopt, ignore, unignore } = useDiscover({ index, reload });
  const [cursor, setCursor] = useState(0);

  const clampCursor = (next: number): number => {
    if (entries.length === 0) return 0;
    if (next < 0) return 0;
    if (next >= entries.length) return entries.length - 1;
    return next;
  };

  // 条目数变化（adopt/ignore 后 reload）后夹住光标，避免越界指向不存在的行。
  useEffect(() => {
    setCursor((c) => clampCursor(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length]);

  const selected = entries[cursor] ?? null;

  const runMutation = async (fn: () => Promise<void>): Promise<void> => {
    dispatch({ type: "SET_BUSY", busy: true });
    try {
      await fn();
    } catch {
      // 错误（如 adopt 非 discovered）暂不弹窗，busy 在 finally 复位；列表由 snapshot 重算。
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
    }
  };

  useInput(
    (input, key) => {
      if (key.upArrow) return setCursor((c) => clampCursor(c - 1));
      if (key.downArrow) return setCursor((c) => clampCursor(c + 1));

      const lower = input.toLowerCase();
      if (key.tab) {
        const nextScreen = SCREEN_ORDER[(SCREEN_ORDER.indexOf(state.activeScreen) + 1) % SCREEN_ORDER.length];
        return dispatch({ type: "SET_SCREEN", screen: nextScreen });
      }
      if (SCREEN_KEYS[lower]) {
        return dispatch({ type: "SET_SCREEN", screen: SCREEN_KEYS[lower] });
      }

      if (!selected) return;
      if (lower === "a") return void runMutation(() => adopt(selected.skillName));
      if (lower === "i") return void runMutation(() => ignore(selected.skillName));
      if (lower === "u") return void runMutation(() => unignore(selected.skillName));
      if (key.return) {
        dispatch({ type: "SET_FOCUS_SKILL", skillName: selected.skillName });
        dispatch({ type: "SET_SCREEN", screen: "matrix" });
        return;
      }
    },
    { isActive: !state.busy }
  );

  return (
    <Box flexDirection="column">
      <Text bold underline>
        Discover
      </Text>
      {entries.length === 0 ? (
        <Text dimColor>No discovered / external / broken-link / conflict entries. Run `asm refresh` to scan.</Text>
      ) : (
        entries.map((entry, i) => <DiscoverRow key={`${entry.kind}:${entry.skillName}:${i}`} entry={entry} selected={i === cursor} index={i} />)
      )}
      <StatusBar busy={state.busy} lastResult={state.lastResult} pendingCount={state.pending.size} />
    </Box>
  );
}
