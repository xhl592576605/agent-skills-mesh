import { useEffect, useState, type Dispatch } from "react";
import { Box, Text, useInput } from "ink";
import type { ReactElement } from "react";
import { createEmptyIndex } from "../../core/models/index.js";
import type { AppConfig } from "../../core/models/config.js";
import type { IndexFile } from "../../core/models/index.js";
import type { DoctorCheck } from "../../core/services/doctor-service.js";
import { useDoctor, type FixOutcome } from "../hooks/useDoctor.js";
import { StatusBar } from "../components/StatusBar.js";
import type { TuiAction, TuiState } from "../state/types.js";

export interface DoctorScreenProps {
  readonly state: TuiState;
  readonly dispatch: Dispatch<TuiAction>;
  readonly refresh: () => Promise<IndexFile>;
}

const SCREEN_KEYS: Record<string, "matrix" | "discover" | "doctor"> = {
  "1": "matrix",
  "2": "discover",
  "3": "doctor"
};

const SCREEN_ORDER: Array<"matrix" | "discover" | "doctor"> = ["matrix", "discover", "doctor"];

/** snapshot 未就绪时的兜底配置（空 agents/sources，runDoctor 只会检查 config/index 存在性）。 */
const FALLBACK_CONFIG: AppConfig = {
  version: 1,
  settings: { install_strategy: "symlink", default_agent: "pi", auto_refresh_on_start: true },
  paths: { home: "", repos: "", local: "", cache: "", skills: "" },
  sources: [],
  agents: {},
  skillOverrides: {}
};

/** status → 终端安全符号（与 asm doctor CLI 一致：✓ ok / ! warning / ✗ error）。 */
function statusSymbol(status: DoctorCheck["status"]): string {
  switch (status) {
    case "ok":
      return "✓";
    case "warning":
      return "!";
    case "error":
      return "✗";
  }
}

/** 待确认的修复集合：单项或全部可修复项。 */
interface PendingFix {
  readonly mode: "single" | "all";
  readonly checks: readonly DoctorCheck[];
}

function DoctorRow({ check, selected }: { readonly check: DoctorCheck; readonly selected: boolean }): ReactElement {
  return (
    <Text>
      <Text bold={selected} color={selected ? "cyan" : undefined}>
        {selected ? "❯ " : "  "}
      </Text>
      <Text color={check.status === "ok" ? "green" : check.status === "warning" ? "yellow" : "red"}>{statusSymbol(check.status)}</Text>
      <Text bold={selected}>
        {" "}
        {check.kind}
      </Text>
      <Text dimColor> {check.message}</Text>
      {check.fix ? <Text color="cyan"> [f] fix</Text> : null}
    </Text>
  );
}

/**
 * Doctor 屏幕：渲染 runDoctor 检查项，对可修复项（带 `fix`）提供单项/批量修复。
 *
 * 写操作安全（design R5）：`f`/`F` 不直接修复，而是先弹出确认框列出将执行的修复；
 * 仅在用户按 `y` 后才调用 useDoctor.applyFix/applyAllFixable（→ service 执行 repair/mkdir）。
 * 修复完成后 refresh → snapshot 更新 → useDoctor 自动重跑，该项转 ok 或消失。
 */
export function DoctorScreen({ state, dispatch, refresh }: DoctorScreenProps): ReactElement {
  const config: AppConfig = state.snapshot?.config ?? FALLBACK_CONFIG;
  const index: IndexFile = state.snapshot?.index ?? createEmptyIndex();
  const { checks, loading, applyFix, applyAllFixable } = useDoctor({ config, index, refresh });
  const [cursor, setCursor] = useState(0);
  const [pending, setPending] = useState<PendingFix | null>(null);

  const clampCursor = (next: number): number => {
    if (checks.length === 0) return 0;
    if (next < 0) return 0;
    if (next >= checks.length) return checks.length - 1;
    return next;
  };

  // 检查项数变化（修复后 rerun）后夹住光标，避免越界。
  useEffect(() => {
    setCursor((c) => clampCursor(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checks.length]);

  const selected = checks[cursor] ?? null;

  const handleConfirm = async (): Promise<void> => {
    if (!pending) return;
    const scope = pending;
    setPending(null); // 关闭确认框，避免 apply 期间再触发按键。
    dispatch({ type: "SET_BUSY", busy: true });
    try {
      if (scope.mode === "single") {
        await applyFix(scope.checks[0]);
      } else {
        const outcome: FixOutcome = await applyAllFixable();
        dispatch({ type: "SET_LAST_RESULT", result: { applied: outcome.applied, skipped: outcome.skipped } });
      }
    } catch {
      // 单项失败已在 useDoctor 内捕获；批量结果已在 lastResult 记录；busy 在 finally 复位。
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
    }
  };

  useInput(
    (input, key) => {
      // 确认框打开时：只响应 y/n/esc。
      if (pending) {
        if (input.toLowerCase() === "y") return void handleConfirm();
        if (input.toLowerCase() === "n" || key.escape) return setPending(null);
        return;
      }
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

      if (lower === "f" && selected?.fix) {
        return setPending({ mode: "single", checks: [selected] });
      }
      if (lower === "F") {
        const fixable = checks.filter((check) => check.fix);
        if (fixable.length > 0) setPending({ mode: "all", checks: fixable });
        return;
      }
    },
    { isActive: !state.busy }
  );

  return (
    <Box flexDirection="column">
      <Text bold underline>
        Doctor
      </Text>
      {loading ? (
        <Text dimColor>Running checks…</Text>
      ) : checks.length === 0 ? (
        <Text dimColor>No checks.</Text>
      ) : (
        checks.map((check, i) => <DoctorRow key={`${check.kind}:${i}`} check={check} selected={i === cursor} />)
      )}
      <StatusBar busy={state.busy} lastResult={state.lastResult} pendingCount={state.pending.size} />
      {pending ? <FixConfirm pending={pending} /> : null}
    </Box>
  );
}

/** 修复二次确认框：列出将执行的修复，y 应用 / n 取消（终端安全文本）。 */
function FixConfirm({ pending }: { readonly pending: PendingFix }): ReactElement {
  const heading = pending.mode === "single" ? "Apply fix?" : `Apply all fixes? (${pending.checks.length} item(s))`;
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} marginTop={1}>
      <Text bold underline>
        {heading}
      </Text>
      {pending.checks.map((check, i) => {
        const label = fixLabel(check);
        return (
          <Text key={i}>
            {"• "}
            {check.kind}: {label}
          </Text>
        );
      })}
      <Text dimColor>These actions will modify the filesystem (repair symlink / create dir / refresh).</Text>
      <Text>
        <Text bold>[y]</Text> apply <Text dimColor>·</Text> <Text bold>[n]</Text> cancel
      </Text>
    </Box>
  );
}

/** 把 fix 描述为人类可读动作（不依赖颜色）。 */
function fixLabel(check: DoctorCheck): string {
  const fix = check.fix;
  if (!fix) return check.message;
  switch (fix.type) {
    case "refresh-index":
      return "refresh index";
    case "mkdir-agent-dir":
      return `create dir ${fix.targetPath ?? ""}`.trim();
    case "repair-broken-link":
      return `repair symlink ${fix.skillName ?? "?"} → ${fix.agentId ?? "?"}`;
  }
}
