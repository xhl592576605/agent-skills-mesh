import { useCallback } from "react";
import type { AppConfig } from "../../core/models/config.js";
import type { IndexFile } from "../../core/models/index.js";
import type { InstallPlan, UninstallPlan } from "../../core/models/install-plan.js";
import {
  applyInstallPlan,
  applyUninstallPlan,
  buildInstallPlan,
  buildUninstallPlan
} from "../../core/services/install-service.js";
import type { PendingIntent } from "../state/types.js";

/**
 * 单条 pending 的 plan 聚合：意图 + 对应 install/uninstall plan。
 * plan 类型保留 service 原样输出，组件按 action.type 渲染。
 */
export interface PendingPlanEntry {
  readonly intent: PendingIntent;
  readonly plan: InstallPlan | UninstallPlan;
}

/** buildReview 的聚合结果：条目 + 统计（供 PlanReviewModal 与 StatusBar 展示）。 */
export interface PlanReview {
  readonly entries: PendingPlanEntry[];
  readonly totalActions: number;
  readonly conflicts: number;
}

/** applyAll 的结果：成功/跳过计数 + refresh 后的新 index（供 dispatch SET_SNAPSHOT）。 */
export interface ApplyOutcome {
  readonly applied: number;
  readonly skipped: number;
  readonly newIndex: IndexFile;
}

export type RefreshFn = () => Promise<IndexFile>;

/**
 * 批量 build/apply install & uninstall 的 hook（.ts，无 JSX）。
 *
 * 安全约束（backend/quality-guidelines）：
 * - build 阶段只读 FS（detect 当前 target），写操作仅发生在 apply。
 * - apply 仅在调用方「用户已确认」后调用（PlanReviewModal 的 y）。
 * - hasConflict 的 plan 在 apply 阶段跳过（不抛），单条失败 try/catch 不中断。
 * - 全部 apply 完成后调 refresh() 拿新 index 回写 snapshot。
 */
export function useInstallPlan(refresh: RefreshFn): {
  buildReview: (config: AppConfig, index: IndexFile, pending: ReadonlyMap<string, ReadonlyMap<string, PendingIntent>>) => Promise<PlanReview>;
  applyAll: (config: AppConfig, index: IndexFile, pending: ReadonlyMap<string, ReadonlyMap<string, PendingIntent>>) => Promise<ApplyOutcome>;
} {
  const buildReview = useCallback(
    async (
      config: AppConfig,
      index: IndexFile,
      pending: ReadonlyMap<string, ReadonlyMap<string, PendingIntent>>
    ): Promise<PlanReview> => {
      const entries: PendingPlanEntry[] = [];
      let totalActions = 0;
      let conflicts = 0;
      for (const [skillName, agents] of pending) {
        for (const [agentId, intent] of agents) {
          const plan =
            intent === "install"
              ? await buildInstallPlan(config, index, skillName, agentId)
              : await buildUninstallPlan(config, skillName, agentId);
          entries.push({ intent, plan });
          totalActions += plan.actions.length;
          if (plan.hasConflict) conflicts += 1;
        }
      }
      return { entries, totalActions, conflicts };
    },
    []
  );

  const applyAll = useCallback(
    async (
      config: AppConfig,
      index: IndexFile,
      pending: ReadonlyMap<string, ReadonlyMap<string, PendingIntent>>
    ): Promise<ApplyOutcome> => {
      let applied = 0;
      let skipped = 0;
      for (const [skillName, agents] of pending) {
        for (const [agentId, intent] of agents) {
          try {
            if (intent === "install") {
              const plan = await buildInstallPlan(config, index, skillName, agentId);
              if (plan.hasConflict) {
                skipped += 1;
                continue;
              }
              await applyInstallPlan(plan);
            } else {
              const plan = await buildUninstallPlan(config, skillName, agentId);
              if (plan.hasConflict) {
                skipped += 1;
                continue;
              }
              await applyUninstallPlan(plan);
            }
            applied += 1;
          } catch {
            // 单条失败（如权限/竞争）记录跳过，不中断批量（design apply 失败策略）。
            skipped += 1;
          }
        }
      }
      const newIndex = await refresh();
      return { applied, skipped, newIndex };
    },
    [refresh]
  );

  return { buildReview, applyAll };
}
