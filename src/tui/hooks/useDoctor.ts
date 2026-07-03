import { useCallback, useEffect, useState } from "react";
import { runDoctor } from "../../core/services/doctor-service.js";
import type { DoctorCheck, DoctorFix } from "../../core/services/doctor-service.js";
import { applyRepairPlan, buildRepairPlan } from "../../core/services/install-service.js";
import { ensureDir } from "../../utils/fs.js";
import { ConfigStore } from "../../core/storage/config-store.js";
import { IndexStore } from "../../core/storage/index-store.js";
import { StateStore } from "../../core/storage/state-store.js";
import type { AppConfig } from "../../core/models/config.js";
import type { IndexFile } from "../../core/models/index.js";

export interface UseDoctorInput {
  readonly config: AppConfig;
  readonly index: IndexFile;
  /** refresh-index / 修复后重新扫描（useIndexState.refresh），让 snapshot + doctor 反映变更。 */
  readonly refresh: () => Promise<IndexFile>;
}

/** 单次/批量修复的汇总（与 Matrix apply 结果一致语义）。 */
export interface FixOutcome {
  readonly applied: number;
  readonly skipped: number;
}

export interface UseDoctorResult {
  readonly checks: readonly DoctorCheck[];
  readonly loading: boolean;
  /** 手动重跑 doctor（通常无需调用：config/index 变更后 effect 自动重跑）。 */
  readonly rerun: () => Promise<void>;
  /** 对单个可修复项执行修复，完成后 refresh（→ effect 自动重跑 doctor）。 */
  readonly applyFix: (check: DoctorCheck) => Promise<void>;
  /** 收集所有带 fix 的项逐个修复，单项失败不中断，结束后统一 refresh。 */
  readonly applyAllFixable: () => Promise<FixOutcome>;
}

/**
 * Doctor 屏的域行为封装（.ts，无 JSX）。
 *
 * 「哪些可修复」的知识留在 service（DoctorCheck.fix），本 hook 只按 `fix.type` 调度：
 * - refresh-index → refresh（重新扫描）。
 * - mkdir-agent-dir → ensureDir(fix.targetPath)。
 * - repair-broken-link → buildRepairPlan + applyRepairPlan（仅 symlink，真实目录拒绝）。
 * 均在调用方（DoctorScreen）二次确认后才调用本 hook 的 apply*。
 */
export function useDoctor({ config, index, refresh }: UseDoctorInput): UseDoctorResult {
  const [configStore] = useState(() => new ConfigStore());
  const [indexStore] = useState(() => new IndexStore(configStore.home));
  const [stateStore] = useState(() => new StateStore(configStore.home));
  const [checks, setChecks] = useState<DoctorCheck[]>([]);
  const [loading, setLoading] = useState(true);

  const rerun = useCallback(async () => {
    const result = await runDoctor(configStore, indexStore, config, index);
    setChecks(result);
  }, [configStore, indexStore, config, index]);

  // config/index 变更后自动重跑 doctor（refresh 回写 snapshot → 本 hook 重渲染 → effect 重跑）。
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void rerun().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [rerun]);

  /** 执行单条修复的原始操作（不含 refresh），批量修复复用以减少重复扫描。 */
  const executeFix = useCallback(
    async (check: DoctorCheck): Promise<void> => {
      const fix = check.fix;
      if (!fix) throw new Error("check has no fix");
      await executeDoctorFix(fix, { config, indexStore, stateStore, refresh });
    },
    [config, indexStore, stateStore, refresh]
  );

  const applyFix = useCallback(
    async (check: DoctorCheck): Promise<void> => {
      await executeFix(check);
      // 修复后重新扫描：让 snapshot 的 installations/skills 反映磁盘真值，
      // 随后 [config,index] 变更触发上面的 effect 自动重跑 doctor。
      await refresh();
    },
    [executeFix, refresh]
  );

  const applyAllFixable = useCallback(async (): Promise<FixOutcome> => {
    const fixable = checks.filter((check) => check.fix);
    let applied = 0;
    let skipped = 0;
    for (const check of fixable) {
      try {
        await executeFix(check);
        applied += 1;
      } catch {
        // 单项失败（如 repair 已变 conflict / 权限）记录跳过，不中断批量。
        skipped += 1;
      }
    }
    // 批量结束后统一刷新一次（避免每项都扫描）。
    await refresh();
    return { applied, skipped };
  }, [checks, executeFix, refresh]);

  return { checks, loading, rerun, applyFix, applyAllFixable };
}

/** 按 fix.type 调度具体修复动作（repair 读最新 index，避免批量内状态漂移）。 */
async function executeDoctorFix(
  fix: DoctorFix,
  ctx: { config: AppConfig; indexStore: IndexStore; stateStore: StateStore; refresh: () => Promise<IndexFile> }
): Promise<void> {
  switch (fix.type) {
    case "refresh-index":
      await ctx.refresh();
      break;
    case "mkdir-agent-dir":
      if (!fix.targetPath) throw new Error("mkdir-agent-dir fix missing targetPath");
      await ensureDir(fix.targetPath);
      break;
    case "repair-broken-link": {
      if (!fix.skillName || !fix.agentId) throw new Error("repair-broken-link fix missing skillName/agentId");
      // 读最新 index（磁盘真值）：批量修复时上一条 repair 已改变 FS，重读避免候选漂移。
      const latestIndex = await ctx.indexStore.read();
      const plan = await buildRepairPlan(ctx.config, latestIndex, fix.skillName, fix.agentId, await ctx.stateStore.read());
      if (plan.hasConflict) throw new Error(`repair plan has conflicts: ${plan.warnings.join("; ")}`);
      await applyRepairPlan(plan);
      break;
    }
  }
}
