import type { InstalledSkillRecord } from "./state.js";

export type InstallAction =
  | { type: "copy-to-ssot"; sourcePath: string; targetPath: string; replace: boolean }
  | { type: "update-state"; record: InstalledSkillRecord; agentId?: string; removeAgentId?: string }
  | { type: "create-symlink"; agentId: string; targetPath: string; linkTarget: string }
  | { type: "remove-symlink"; agentId: string; targetPath: string }
  | { type: "skip"; agentId: string; reason: string; targetPath?: string }
  | { type: "conflict"; agentId: string; targetPath: string; reason: string }
  | { type: "repair-broken-link"; agentId: string; targetPath: string; oldTarget: string; newTarget: string };

export interface InstallPlan {
  id: string;
  skillName: string;
  sourceCandidateId: string;
  sourcePath: string;
  actions: InstallAction[];
  hasConflict: boolean;
  warnings: string[];
}

export interface UninstallPlan {
  id: string;
  skillName: string;
  actions: InstallAction[];
  hasConflict: boolean;
  warnings: string[];
}

/**
 * 修复 broken-link symlink 的独立 plan（不并入 InstallAction 联合，避免改动 install/uninstall plan 语义）。
 * unlink 旧 symlink 后重建指向 state 记录的 SSOT 路径的新 symlink。
 */
export interface RepairPlan {
  id: string;
  skillName: string;
  agentId: string;
  /** Agent skills_dir 下的 symlink 目标路径。 */
  targetPath: string;
  /** 重建 symlink 指向的目标绝对路径（来自 state 记录的 SSOT 路径）。 */
  newTarget: string;
  hasConflict: boolean;
  warnings: string[];
}
