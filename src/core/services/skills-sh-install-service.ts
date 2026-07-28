/**
 * skills.sh 远程结果 → ASM source/SSOT 安装编排（design §4.3 / §5）。
 *
 * 两阶段、与既有 source/skill 服务解耦：
 * - {@link buildSkillsShInstallPlan}：纯只读 plan builder，做边界/skillId/同名/source 复用或冲突判断，
 *   不 clone、不 refresh、不改 enabled/branch/path。
 * - {@link applySkillsShInstallPlan}：fresh-read 重建 plan → create（`addRepoSource`）/ reuse（只读）→
 *   refresh → 该 source 内按 `skillName === skillId` 精确匹配（恰好一个）→ 事务化 `skillAdd` →
 *   最终 index refresh + 写 IndexStore。create 失败时按 ownership token 严格补偿；reuse 永不删除。
 *
 * 安装结果与手动 `source add` + `skill add` 同构，可被现有 update/remove/doctor/enable 识别。
 * core 只抛 `bizError` 英文兜底，不 import i18n。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig, SourceConfig } from "../models/config.js";
import type { InstalledSkillRecord, StateFile } from "../models/state.js";
import type { IndexFile } from "../models/index.js";
import type { ConfigStore } from "../storage/config-store.js";
import type { StateStore } from "../storage/state-store.js";
import type { IndexStore } from "../storage/index-store.js";
import type { BizError, ErrorCode } from "../errors.js";
import { bizError } from "../errors.js";
import { resolveConfiguredPath } from "../../utils/path.js";
import { assertPathInside, assertSafeSkillName } from "../../utils/safe-path.js";
import { refreshIndex } from "./refresh-service.js";
import { addRepoSource } from "./source-service.js";
import { skillAdd } from "./skill-service.js";
import {
  findCanonicalGitHubSources,
  parseGitHubRepoUrl,
  parseSkillsShGitHubSource,
  type SkillsShSkillRef,
} from "./skills-sh-service.js";

/** source action：create 新建 git source，或 reuse 既有 source。 */
export type SkillsShSourcePlan =
  | { action: "create"; cloneUrl: string }
  | { action: "reuse"; sourceId: string };

/** skills.sh 安装 plan（design §4.3）。冲突计划不允许 apply。 */
export interface SkillsShInstallPlan {
  ref: SkillsShSkillRef;
  source: SkillsShSourcePlan;
  hasConflict: boolean;
  conflictCode?: ErrorCode;
  /** 冲突时供 i18n 插值的参数（与 `err.<conflictCode>` 占位符对应）。 */
  conflictParams?: Record<string, string | number>;
}

/** 仅本次 apply 持有的 created-source ownership token（design §5.2）。 */
export interface CreatedRepoSourceToken {
  sourceId: string;
  canonicalKey: string;
  url: string;
  path: string;
}

export interface SkillsShApplyOptions {
  /** 注入 source 创建（测试用）；缺省调用 {@link addRepoSource}。需复制真实创建语义：
   * clone 到 `repos/<id>` 后写 config 并返回 source。 */
  createRepoSource?: (configStore: ConfigStore, cloneUrl: string) => Promise<SourceConfig>;
}

export interface SkillsShInstallStores {
  configStore: ConfigStore;
  stateStore: StateStore;
  indexStore: IndexStore;
}

export interface SkillsShInstallResult {
  record: InstalledSkillRecord;
  source: SourceConfig;
  sourceAction: "created" | "reused";
  /** 最终 IndexStore 是否写入成功。 */
  indexUpdated: boolean;
  /** 非致命警告（如最终 index 写失败，但 source/SSOT/state 已提交）。 */
  warnings: string[];
}

/**
 * 构建 skills.sh 安装 plan（只读，design §4.3）。
 *
 * 边界校验 → `assertSafeSkillName(skillId)` → SSOT 同名预检 → canonical source
 * create/reuse/disabled/ambiguous 判断。所有冲突以 `hasConflict=true` + `conflictCode` 表达，
 * 不抛错（ref 结构非法也以 conflict 表达，便于 TUI 统一处理）。
 */
export function buildSkillsShInstallPlan(config: AppConfig, state: StateFile, ref: SkillsShSkillRef): SkillsShInstallPlan {
  const fallbackSource: SkillsShSourcePlan = { action: "create", cloneUrl: ref.repository?.cloneUrl ?? "" };

  // 边界：provider / repository / skillId / source 必须齐全且自洽。
  if (!ref || ref.provider !== "skills.sh" || !ref.repository || !ref.skillId || !ref.source) {
    return { ref, source: fallbackSource, hasConflict: true, conflictCode: "SKILLS_SH_INVALID_GITHUB_SOURCE", conflictParams: { source: String(ref?.source ?? "") } };
  }
  // source 严格 owner/repo，且与 repository.key 自洽（防 TUI 传入被篡改的 cloneUrl）。
  const repo = parseSkillsShGitHubSource(ref.source);
  if (!repo || repo.key !== ref.repository.key || repo.cloneUrl !== ref.repository.cloneUrl) {
    return { ref, source: { action: "create", cloneUrl: ref.repository.cloneUrl }, hasConflict: true, conflictCode: "SKILLS_SH_INVALID_GITHUB_SOURCE", conflictParams: { source: ref.source } };
  }
  // skillId 安全名（不抛版）。
  if (!isSafeSkillName(ref.skillId)) {
    return { ref, source: { action: "create", cloneUrl: repo.cloneUrl }, hasConflict: true, conflictCode: "INVALID_SKILL_NAME", conflictParams: { name: ref.skillId } };
  }
  // SSOT 同名预检（state 是 installed 真相）。
  if (state.installedSkills[ref.skillId]) {
    return { ref, source: { action: "create", cloneUrl: repo.cloneUrl }, hasConflict: true, conflictCode: "SKILL_ALREADY_INSTALLED", conflictParams: { name: ref.skillId } };
  }

  // canonical source 复用判断。
  const matches = findCanonicalGitHubSources(config, repo.key);
  if (matches.length === 0) {
    return { ref, source: { action: "create", cloneUrl: repo.cloneUrl }, hasConflict: false };
  }
  if (matches.length > 1) {
    return { ref, source: { action: "create", cloneUrl: repo.cloneUrl }, hasConflict: true, conflictCode: "SKILLS_SH_SOURCE_AMBIGUOUS", conflictParams: { key: repo.key } };
  }
  const matched = matches[0];
  if (!matched.enabled) {
    return { ref, source: { action: "create", cloneUrl: repo.cloneUrl }, hasConflict: true, conflictCode: "SKILLS_SH_SOURCE_DISABLED", conflictParams: { sourceId: matched.id, key: repo.key } };
  }
  return { ref, source: { action: "reuse", sourceId: matched.id }, hasConflict: false };
}

/**
 * 应用 skills.sh 安装 plan（design §4.3 / §5）。
 *
 * fresh-read 重建 plan（防确认期间状态变化）→ create/reuse source → refresh →
 * 精确匹配 candidate（恰好一个）→ 事务化 skillAdd → 最终 index refresh + 写 IndexStore。
 *
 * - create 失败（candidate missing/ambiguous、refresh 失败、SSOT/state 失败）：按 token 严格回滚。
 * - reuse 永不删除/pull/reset/改 branch。
 * - 最终 IndexStore 写失败：保留已提交 source/SSOT/state，返回 warning（不回滚）。
 */
export async function applySkillsShInstallPlan(stores: SkillsShInstallStores, plan: SkillsShInstallPlan, options: SkillsShApplyOptions = {}): Promise<SkillsShInstallResult> {
  const { configStore, stateStore, indexStore } = stores;
  const ref = plan.ref;
  const createRepoSource = options.createRepoSource ?? addRepoSource;

  // Phase 0：fresh-read 重建 plan，冲突则抛（确认期间状态可能已变）。
  const config = await configStore.read();
  const state = await stateStore.read();
  const freshPlan = buildSkillsShInstallPlan(config, state, ref);
  if (freshPlan.hasConflict) throw conflictToError(freshPlan);

  // Phase 1：解析 source ownership。
  let source: SourceConfig;
  let sourceAction: "created" | "reused";
  let token: CreatedRepoSourceToken | undefined;
  const sourcePlan = freshPlan.source;
  if (sourcePlan.action === "create") {
    // 直接调 addRepoSource（不调会触发孤儿 rebind 的 addSource）；clone 失败它自清理半成品。
    source = await createRepoSource(configStore, sourcePlan.cloneUrl);
    sourceAction = "created";
    token = { sourceId: source.id, canonicalKey: ref.repository.key, url: source.url!, path: source.path };
  } else {
    // reuse：fresh-read 只读，不 pull / 不 reset / 不改 branch。
    const reuseConfig = await configStore.read();
    const found = reuseConfig.sources.find((entry) => entry.id === sourcePlan.sourceId);
    if (!found || !found.enabled) {
      // 极竞态：确认后被禁用/删除。报告冲突，不创建任何东西。
      throw bizError("SKILLS_SH_SOURCE_DISABLED", { sourceId: sourcePlan.sourceId, key: ref.repository.key }, `Matching source ${sourcePlan.sourceId} is no longer available/enabled`);
    }
    source = found;
    sourceAction = "reused";
  }

  // Phase 2-3：refresh → 精确匹配 candidate（恰好一个）→ 事务化 skillAdd。
  // candidate 不存在/歧义/refresh 失败/SSOT-state 失败：created 才回滚，reused 永不删。
  try {
    const refreshConfig = await configStore.read();
    const refreshState = await stateStore.read();
    const index = await refreshIndex(refreshConfig, refreshState);

    const candidateError = matchSingleCandidate(index, source.id, ref.skillId, ref.repository.key);
    if (candidateError) throw candidateError;

    // skillAdd 内部 fresh-read 复核 source/origin/path containment，并做事务化 SSOT 复制 + state 写。
    const record = await skillAdd(configStore, stateStore, index, ref.skillId, { source: source.id });

    // Phase 4：最终 index refresh + 写 IndexStore（失败只 warning，不回滚已提交安装）。
    const finalConfig = await configStore.read();
    const finalState = await stateStore.read();
    const finalIndex = await refreshIndex(finalConfig, finalState);
    let indexUpdated = true;
    const warnings: string[] = [];
    try {
      await indexStore.write(finalIndex);
    } catch (error) {
      indexUpdated = false;
      warnings.push(`Index refresh failed (${errorMessage(error)}); press ctrl+r to refresh.`);
    }
    return { record, source, sourceAction, indexUpdated, warnings };
  } catch (error) {
    if (token) {
      await rollbackCreatedRepoSource(configStore, token, error);
    }
    throw error;
  }
}

/**
 * 在指定 source 内按 `candidate.skillName === skillId` 精确匹配，必须恰好一个。
 *
 * 0 个 → `SKILLS_SH_CANDIDATE_NOT_FOUND`；多个 → `SKILLS_SH_CANDIDATE_AMBIGUOUS`。
 * **禁止**用 API name、目录 basename 或模糊 fallback。
 */
function matchSingleCandidate(index: IndexFile, sourceId: string, skillId: string, key: string): BizError | undefined {
  const skill = index.skills[skillId];
  const matches = (skill?.candidates ?? []).filter(
    (candidate) => candidate.origin === "configured-source" && candidate.sourceId === sourceId && candidate.skillName === skillId,
  );
  if (matches.length === 0) {
    return bizError("SKILLS_SH_CANDIDATE_NOT_FOUND", { skillId, key }, `Skill ${skillId} not found in repository ${key}`);
  }
  if (matches.length > 1) {
    return bizError("SKILLS_SH_CANDIDATE_AMBIGUOUS", { skillId, key }, `Skill ${skillId} has multiple candidates in repository ${key}`);
  }
  return undefined;
}

/**
 * 回滚本次新建的 git source（design §5.2）。
 *
 * 严格身份核对（sourceId/type/canonical URL/path + repos containment）后才删：
 * 1. fresh-read config，按 token 核对仍是同一个 source；身份不一致拒绝删除。
 * 2. 先原子移除 config source 记录；写失败则保留 clone，抛 rollback-incomplete。
 * 3. 再校验 clone path 严格位于 `config.paths.repos` 下并删除；删除失败抛 rollback-incomplete（含残留路径）。
 *
 * 不使用 `removeSource(--purge)`，避免误删同 source 既有 skill 或遗漏无 state 的 SSOT 残留。
 * 仅 `action=create` 调用；reused source 永不进入此函数。
 */
async function rollbackCreatedRepoSource(configStore: ConfigStore, token: CreatedRepoSourceToken, originalError: unknown): Promise<void> {
  const config = await configStore.read();
  const source = config.sources.find((entry) => entry.id === token.sourceId);
  if (!source) return; // 已不在 config（可能被并发删除），无可回滚。

  // 严格身份核对：type / canonical URL / path 必须与 token 完全一致。
  if (source.type !== "git-repo" || source.url !== token.url || source.path !== token.path) return;
  const ref = parseGitHubRepoUrl(source.url!);
  if (!ref || ref.key !== token.canonicalKey) return;

  // 1. 移除 config source 记录（原子写）。
  const withoutSource: AppConfig = { ...config, sources: config.sources.filter((entry) => entry.id !== token.sourceId) };
  try {
    await configStore.write(withoutSource);
  } catch (error) {
    throw rollbackIncomplete(originalError ?? error, `config write failed; clone leftover: ${token.path}`);
  }

  // 2. 校验 clone path 严格位于 repos 下，再删除。
  const reposDir = resolveConfiguredPath(config.paths.repos);
  const cloneTarget = resolveConfiguredPath(token.path);
  const rel = path.relative(reposDir, cloneTarget);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    // 不在 repos 下：不删（保守），报告残留。
    throw rollbackIncomplete(originalError, `clone path not under repos dir: ${cloneTarget}`);
  }
  try {
    await fs.rm(cloneTarget, { recursive: true, force: true });
  } catch (error) {
    throw rollbackIncomplete(originalError ?? error, `clone delete failed; leftover: ${cloneTarget}`);
  }
}

/** 把 conflict plan 转成 bizError（英文兜底）。 */
function conflictToError(plan: SkillsShInstallPlan): BizError {
  const code = plan.conflictCode!;
  return bizError(code, plan.conflictParams ?? {}, conflictMessage(plan));
}

function conflictMessage(plan: SkillsShInstallPlan): string {
  switch (plan.conflictCode) {
    case "SKILLS_SH_INVALID_GITHUB_SOURCE":
      return `Result is not a safe GitHub source: ${plan.ref.source}`;
    case "INVALID_SKILL_NAME":
      return `Invalid skill name: ${plan.ref.skillId}`;
    case "SKILL_ALREADY_INSTALLED":
      return `Skill already installed: ${plan.ref.skillId}`;
    case "SKILLS_SH_SOURCE_AMBIGUOUS":
      return `Multiple configured sources match ${plan.ref.repository.key}`;
    case "SKILLS_SH_SOURCE_DISABLED":
      return `Matching source ${plan.conflictParams?.sourceId} is disabled`;
    default:
      return plan.conflictCode!;
  }
}

/** 构造 rollback-incomplete 错误，保留原始错误信息与残留路径。 */
function rollbackIncomplete(originalError: unknown, detail: string): BizError {
  const original = errorMessage(originalError);
  const message = `${original}; ${detail}`;
  return bizError("SKILLS_SH_ROLLBACK_INCOMPLETE", { message }, `Install failed and cleanup incomplete: ${message}`);
}

/** 不抛版的 skill 名校验（plan builder 用，避免在纯函数里抛错）。 */
function isSafeSkillName(name: string): boolean {
  try {
    assertSafeSkillName(name);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
