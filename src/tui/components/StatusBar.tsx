import { Text } from "ink";
import type { ReactElement } from "react";
import type { ApplyResult } from "../state/types.js";

export interface StatusBarProps {
  readonly busy: boolean;
  readonly lastResult: ApplyResult | null;
  readonly pendingCount: number;
}

/** 底部状态栏：busy / 上次 apply 结果 / 待提交 pending 计数（纯展示）。 */
export function StatusBar({ busy, lastResult, pendingCount }: StatusBarProps): ReactElement {
  const segments: string[] = [];
  segments.push(busy ? "working…" : "ready");
  if (lastResult) {
    segments.push(`${lastResult.applied} applied / ${lastResult.skipped} skipped`);
  }
  if (pendingCount > 0) {
    segments.push(`${pendingCount} pending`);
  }
  return (
    <Text dimColor>
      {segments.join("  ·  ")}
    </Text>
  );
}
