import { Box, Text, useInput } from "ink";
import type { ReactElement } from "react";
import type { InstallAction } from "../../core/models/install-plan.js";
import type { PlanReview, PendingPlanEntry } from "../hooks/useInstallPlan.js";

export interface PlanReviewModalProps {
  readonly review: PlanReview;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** 把单条 action 渲染为终端安全文本（符号/文字双重编码，不依赖颜色）。 */
function formatAction(action: InstallAction): { label: string; conflict: boolean } {
  switch (action.type) {
    case "copy-to-ssot":
      return { label: `copy to SSOT → ${action.targetPath}`, conflict: false };
    case "update-state":
      return { label: `update state → ${action.record.skillName}`, conflict: false };
    case "create-symlink":
      return { label: `install → ${action.agentId}`, conflict: false };
    case "remove-symlink":
      return { label: `uninstall → ${action.agentId}`, conflict: false };
    case "skip":
      return { label: `skip ${action.agentId} (${action.reason})`, conflict: false };
    case "conflict":
      return { label: `CONFLICT ${action.agentId}: ${action.reason}`, conflict: true };
    case "repair-broken-link":
      return { label: `repair → ${action.agentId}`, conflict: false };
  }
}

function PlanEntry({ entry }: { readonly entry: PendingPlanEntry }): ReactElement {
  const intentLabel = entry.intent === "install" ? "install" : "uninstall";
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{entry.plan.skillName}</Text>
        <Text dimColor> · {intentLabel}</Text>
        {entry.plan.hasConflict ? <Text color="red"> [has conflict]</Text> : null}
      </Text>
      {entry.plan.actions.map((action, i) => {
        const { label, conflict } = formatAction(action);
        return (
          <Text key={i} color={conflict ? "red" : undefined}>
            {"  "}
            {conflict ? "✗ " : "• "}
            {label}
          </Text>
        );
      })}
    </Box>
  );
}

/**
 * pending plan 聚合 review 弹窗。列出 actions + 冲突项，确认后调用方才 apply。
 *
 * 写操作安全点：本组件不触发任何 FS 变更，仅在 `y` 时回调 onConfirm，
 * 由 MatrixScreen → useInstallPlan.applyAll 真正执行 plan。
 */
export function PlanReviewModal({ review, onConfirm, onCancel }: PlanReviewModalProps): ReactElement {
  useInput((input, key) => {
    if (input.toLowerCase() === "y") {
      onConfirm();
    } else if (input.toLowerCase() === "n" || key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold underline>
        Review pending plan
      </Text>
      {review.entries.length === 0 ? (
        <Text dimColor>No pending operations.</Text>
      ) : (
        review.entries.map((entry, i) => <PlanEntry key={`${entry.plan.skillName}:${i}`} entry={entry} />)
      )}
      <Text dimColor>
        {review.totalActions} action(s) · {review.conflicts} conflict(s)
      </Text>
      <Text>
        <Text bold>[y]</Text> apply <Text dimColor>·</Text> <Text bold>[n]</Text> cancel
      </Text>
    </Box>
  );
}
