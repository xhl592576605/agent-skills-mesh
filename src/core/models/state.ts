import type { SourceType } from "./config.js";

export interface StateFile {
  version: 1;
  installedSkills: Record<string, InstalledSkillRecord>;
  /** 维度1（source 有更新）检测结果，按 sourceId 索引；首次检测前缺省。 */
  sourceSnapshots?: Record<string, SourceSnapshot>;
}

/**
 * 维度1检测快照：source 是否有更新。
 *
 * - git-repo: fingerprint = 本地 HEAD commit SHA；hasUpdate = fetch 后 upstream 与本地不同。
 * - local-dir/single-skill/global-dir: fingerprint = sha256Directory(sourceRoot)；hasUpdate = 当前 hash 与已知不同。
 * - agent-dir: 不纳入检测。
 */
export interface SourceSnapshot {
  /** git: 本地 HEAD SHA；local: 源根目录 hash。 */
  fingerprint: string;
  /** 上次检测结论：远端/当前 vs 已知 fingerprint 是否不同。 */
  hasUpdate: boolean;
  /** 检测时间戳（ISO）。 */
  checkedAt: string;
  /** 检测失败原因（网络/无 upstream 等）；有值时 hasUpdate 不可信。 */
  error?: string;
}

export interface InstalledSkillRecord {
  skillName: string;
  displayName: string;
  description?: string;
  tags: string[];
  ssotPath: string;
  source: InstalledSkillSource;
  contentHash: string;
  /** 维度2：上次检测到的「源 skill 目录」sha256Directory；缺省=未检测。与 contentHash 不同=可更新。 */
  sourceHash?: string;
  installedAt: string;
  updatedAt: string;
  enabledAgents: Record<string, InstalledAgentRecord>;
}

export interface InstalledAgentRecord {
  agentId: string;
  targetPath: string;
  linkedAt: string;
}

export type InstalledSkillSource =
  | {
      kind: "configured-source";
      sourceId: string;
      sourceType: SourceType;
      sourcePath: string;
      relativePath: string;
      url?: string;
      branch?: string;
    }
  | {
      kind: "manual-import";
      originalPath?: string;
    };

export function createEmptyState(): StateFile {
  return { version: 1, installedSkills: {}, sourceSnapshots: {} };
}
