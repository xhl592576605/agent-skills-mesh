import type { SourceType } from "./config.js";

export type SkillOrigin = "configured-source" | "global-dir" | "agent-dir" | "manual-add" | "manual-import";
export type SkillStatus = "managed" | "discovered" | "conflict" | "ignored" | "missing";

export interface SkillCandidate {
  id: string;
  skillName: string;
  sourceId: string;
  sourceType: SourceType;
  path: string;
  entry: "SKILL.md";
  description?: string;
  frontmatter?: Record<string, unknown>;
  tags: string[];
  hash: string;
  mtimeMs: number;
  size: number;
  origin: SkillOrigin;
  managed: boolean;
}

export interface SkillRecord {
  name: string;
  displayName: string;
  description?: string;
  tags: string[];
  status: SkillStatus;
  preferredCandidateId?: string;
  preferredSourceId?: string;
  candidates: SkillCandidate[];
  supportedAgents?: string[];
  ignored?: boolean;
}
