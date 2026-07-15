import path from "node:path";
import type { AppConfig, SourceConfig } from "../models/config.js";
import type { InstalledSkillRecord, SourceSnapshot, StateFile } from "../models/state.js";
import { ConfigStore } from "../storage/config-store.js";
import type { StateStore } from "../storage/state-store.js";
import { gitFetch, gitRevParse } from "../../utils/git.js";
import { sha256Directory } from "../../utils/hash.js";
import { pathExists } from "../../utils/fs.js";
import { resolveConfiguredPath } from "../../utils/path.js";
import { resolveSourceSkillDir } from "./source-service.js";
import { bizError } from "../errors.js";

/**
 * 更新检测服务（design §3）。
 *
 * 两个独立维度：
 * - 维度1「source 有更新」：`checkSources` —— git 源 fetch+rev-parse / 本地源 sha256Directory，
 *   结果写入 `state.sourceSnapshots`。
 * - 维度2「skill 与 SSOT 有差异」：`checkSkillUpdates` —— 已安装 skill 的源目录 hash vs
 *   `contentHash`，结果写入 `record.sourceHash`。
 *
 * 检测失败（网络/无 upstream/路径缺失）**降级为 `snapshot.error`，不抛错**——符合
 * `backend/error-handling.md`「expected absence → values」；单 source 失败不阻断其他。
 */

// ─── 派生纯函数（无副作用，供 TUI/CLI 随处读检测结果） ───

/**
 * 维度2派生：已安装 skill 是否可更新（源目录 hash 与 SSOT contentHash 不同）。
 *
 * `sourceHash` 缺省（未检测过）→ false。仅语义"已检测且与 SSOT 不同"才为 true。
 */
export function isSkillUpdatable(record: InstalledSkillRecord): boolean {
  if (record.sourceHash === undefined) return false;
  return record.sourceHash !== record.contentHash;
}

/**
 * 维度1派生：source 是否有更新。snapshot 缺省 / 有 error → false（不可信不显示）。
 */
export function isSourceUpdatable(snapshots: Record<string, SourceSnapshot>, sourceId: string): boolean {
  const snap = snapshots[sourceId];
  return snap?.hasUpdate === true && !snap.error;
}

/** 统计：有更新的 source 数（hasUpdate 且无 error）。 */
export function countUpdatableSources(snapshots: Record<string, SourceSnapshot>): number {
  return Object.keys(snapshots).filter((id) => isSourceUpdatable(snapshots, id)).length;
}

/** 列出可更新到 SSOT 的已安装 skill 名称（稳定排序，供批量操作与 UI 共用）。 */
export function listUpdatableSkillNames(state: StateFile): string[] {
  return Object.values(state.installedSkills)
    .filter(isSkillUpdatable)
    .map((record) => record.skillName)
    .sort((a, b) => a.localeCompare(b));
}

/** 统计：可更新到 SSOT 的已安装 skill 数。 */
export function countUpdatableSkills(state: StateFile): number {
  return listUpdatableSkillNames(state).length;
}

// ─── 维度1：source 有更新 ───

export interface SourceCheckResult {
  sourceId: string;
  snapshot: SourceSnapshot;
}

/**
 * 检测 source 是否有更新，写回 `state.sourceSnapshots`。
 *
 * - git-repo: `git fetch` + `rev-parse HEAD` vs upstream（`@{u}`，fallback `origin/<branch>`）；
 *   fingerprint = 本地 HEAD SHA。
 * - local-dir/single-skill/global-dir: `sha256Directory(sourceRoot)`；fingerprint = 该 hash。
 * - agent-dir: 不纳入（调用方已过滤）。
 * - 首次（无旧 snapshot）: `hasUpdate = false`（建立基线）。
 *
 * @param sourceId 缺省=全部 enabled 非 agent-dir source；指定=仅该 source（未知 id 抛 SOURCE_ID_UNKNOWN）。
 */
export async function checkSources(
  configStore: ConfigStore,
  stateStore: StateStore,
  sourceId?: string
): Promise<SourceCheckResult[]> {
  const config = await configStore.read();
  const state = await stateStore.read();
  const targets: SourceConfig[] = sourceId
    ? [requireSource(config, sourceId)]
    : config.sources.filter((source) => source.enabled && source.type !== "agent-dir");

  const results = await Promise.all(targets.map((source) => checkOneSource(state, source)));
  if (!state.sourceSnapshots) state.sourceSnapshots = {};
  for (const result of results) {
    state.sourceSnapshots[result.sourceId] = result.snapshot;
  }
  await stateStore.write(state);
  return results;
}

/** 检测单个 source：按类型分发，失败降级为 error snapshot。 */
async function checkOneSource(state: StateFile, source: SourceConfig): Promise<SourceCheckResult> {
  const now = new Date().toISOString();
  const old = state.sourceSnapshots?.[source.id];
  try {
    return source.type === "git-repo"
      ? await checkGitSource(source, now)
      : await checkLocalSource(source, old, now);
  } catch (error) {
    return {
      sourceId: source.id,
      snapshot: {
        fingerprint: old?.fingerprint ?? "",
        hasUpdate: old?.hasUpdate ?? false,
        checkedAt: now,
        error: errorMessage(error)
      }
    };
  }
}

/** git-repo 检测：fetch 后比较本地 HEAD 与 upstream。 */
async function checkGitSource(source: SourceConfig, now: string): Promise<SourceCheckResult> {
  const dest = resolveConfiguredPath(source.path);
  if (!(await pathExists(dest))) {
    return {
      sourceId: source.id,
      snapshot: { fingerprint: "", hasUpdate: false, checkedAt: now, error: "source not cloned yet" }
    };
  }
  await gitFetch(dest);
  const local = await gitRevParse(dest, "HEAD");
  const remote = await resolveUpstreamSha(dest, source);
  return {
    sourceId: source.id,
    snapshot: { fingerprint: local, hasUpdate: remote !== local, checkedAt: now }
  };
}

/** 解析 upstream SHA：优先 `@{u}`；无 upstream 时 fallback `origin/<branch>`（缺省 main）。 */
async function resolveUpstreamSha(dest: string, source: SourceConfig): Promise<string> {
  try {
    return await gitRevParse(dest, "@{u}");
  } catch {
    const branch = source.branch ?? "main";
    return await gitRevParse(dest, `origin/${branch}`);
  }
}

/** 本地源检测：sha256Directory(sourceRoot) 与已知 fingerprint 比较。 */
async function checkLocalSource(
  source: SourceConfig,
  old: SourceSnapshot | undefined,
  now: string
): Promise<SourceCheckResult> {
  const dest = resolveConfiguredPath(source.path);
  if (!(await pathExists(dest))) {
    return {
      sourceId: source.id,
      snapshot: { fingerprint: "", hasUpdate: false, checkedAt: now, error: "source path missing" }
    };
  }
  const current = await sha256Directory(dest);
  const hasUpdate = old ? current !== old.fingerprint : false;
  return {
    sourceId: source.id,
    snapshot: { fingerprint: current, hasUpdate, checkedAt: now }
  };
}

// ─── 维度2：skill 与 SSOT 有差异 ───

export interface SkillCheckResult {
  skillName: string;
  sourceHash: string;
  updatable: boolean;
}

/**
 * 检测已安装 skill 与 SSOT 的差异，写回 `record.sourceHash`。
 *
 * 仅遍历 configured-source 且 source 仍在 config 的 installed skill（跳过 orphan / manual-import）；
 * 源 SKILL.md 缺失的跳过（该 skill 由现有逻辑报 orphan/missing）。
 *
 * @param sourceId 缺省=全部；指定时只查该 source 下的 skill。
 */
export async function checkSkillUpdates(
  configStore: ConfigStore,
  stateStore: StateStore,
  sourceId?: string
): Promise<SkillCheckResult[]> {
  const config = await configStore.read();
  const state = await stateStore.read();
  const results: SkillCheckResult[] = [];
  for (const record of Object.values(state.installedSkills)) {
    const src = record.source;
    if (src.kind !== "configured-source") continue;
    if (sourceId && src.sourceId !== sourceId) continue;
    const source = config.sources.find((entry) => entry.id === src.sourceId);
    if (!source) continue; // orphan：source 已 remove，跳过
    const skillDir = resolveSourceSkillDir(source, src.relativePath);
    if (!(await pathExists(path.join(skillDir, "SKILL.md")))) continue;
    const sourceHash = await sha256Directory(skillDir);
    record.sourceHash = sourceHash;
    results.push({ skillName: record.skillName, sourceHash, updatable: sourceHash !== record.contentHash });
  }
  await stateStore.write(state);
  return results;
}

// ─── 辅助 ───

function requireSource(config: AppConfig, id: string): SourceConfig {
  const source = config.sources.find((entry) => entry.id === id);
  if (!source) throw bizError("SOURCE_ID_UNKNOWN", { id }, `Unknown source id: ${id}`);
  return source;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
