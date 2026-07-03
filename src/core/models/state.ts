import type { SourceType } from "./config.js";

export interface StateFile {
  version: 1;
  installedSkills: Record<string, InstalledSkillRecord>;
}

export interface InstalledSkillRecord {
  skillName: string;
  displayName: string;
  description?: string;
  tags: string[];
  ssotPath: string;
  source: InstalledSkillSource;
  contentHash: string;
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
  return { version: 1, installedSkills: {} };
}
