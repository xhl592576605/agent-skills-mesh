import type { InstallationRecord } from "./installation.js";
import type { SkillRecord } from "./skill.js";

export interface IssueRecord {
  id: string;
  severity: "info" | "warning" | "error";
  kind: string;
  message: string;
  ref?: string;
}

export interface IndexFile {
  version: 1;
  updatedAt: string;
  skills: Record<string, SkillRecord>;
  installations: Record<string, InstallationRecord>;
  issues: IssueRecord[];
}

export function createEmptyIndex(): IndexFile {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    skills: {},
    installations: {},
    issues: []
  };
}
