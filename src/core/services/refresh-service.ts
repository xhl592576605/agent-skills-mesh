import type { AppConfig, SkillOverride, SourceConfig } from "../models/config.js";
import { createEmptyIndex, type IndexFile, type IssueRecord } from "../models/index.js";
import type { SkillCandidate, SkillRecord, SkillStatus } from "../models/skill.js";
import { scanSource } from "../scanners/skill-scanner.js";
import { detectInstallations } from "./install-service.js";

export async function refreshIndex(config: AppConfig, previous: IndexFile = createEmptyIndex()): Promise<IndexFile> {
  const sources = buildRefreshSources(config);
  const candidates = (await Promise.all(sources.filter((source) => source.enabled).map(scanSource))).flat();
  const skills = mergeCandidates(candidates, config.skillOverrides);
  for (const name of Object.keys(previous.skills)) {
    if (!skills[name]) skills[name] = buildSkillRecord(name, [], config.skillOverrides[name]);
  }
  const installations = await detectInstallations(config, skills);
  const issues = buildIssues(skills, installations);
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    sources: Object.fromEntries(sources.map((source) => [source.id, source])),
    skills,
    installations,
    issues
  };
}

export function buildRefreshSources(config: AppConfig): SourceConfig[] {
  const sources = [...config.sources];
  for (const [agentId, agent] of Object.entries(config.agents)) {
    sources.push({
      id: `agent-${agentId}-skills`,
      name: `${agent.name} Skills`,
      type: "agent-dir",
      path: agent.skills_dir,
      enabled: agent.enabled,
      readonly: false
    });
  }
  return sources;
}

export function mergeCandidates(candidates: SkillCandidate[], overrides: Record<string, SkillOverride> = {}): Record<string, SkillRecord> {
  const groups = new Map<string, SkillCandidate[]>();
  for (const candidate of candidates) {
    groups.set(candidate.skillName, [...(groups.get(candidate.skillName) ?? []), candidate]);
  }
  const skills: Record<string, SkillRecord> = {};
  for (const [name, group] of groups) {
    skills[name] = buildSkillRecord(name, group, overrides[name]);
  }
  return skills;
}

function buildSkillRecord(name: string, group: SkillCandidate[], override?: SkillOverride): SkillRecord {
  const preferredCandidateId = override?.preferredCandidateId && group.some((candidate) => candidate.id === override.preferredCandidateId) ? override.preferredCandidateId : undefined;
  const preferredSourceId = override?.preferredSourceId && group.some((candidate) => candidate.sourceId === override.preferredSourceId) ? override.preferredSourceId : undefined;
  const tags = [...new Set(group.flatMap((candidate) => candidate.tags))];
  return {
    name,
    displayName: name,
    description: group.find((candidate) => candidate.description)?.description,
    tags,
    status: calculateStatus(group, override),
    preferredCandidateId,
    preferredSourceId,
    candidates: group.sort((a, b) => a.path.localeCompare(b.path)),
    ignored: override?.ignored
  };
}

function calculateStatus(candidates: SkillCandidate[], override?: SkillOverride): SkillStatus {
  if (override?.ignored) return "ignored";
  if (candidates.length === 0) return "missing";
  if (override?.managed) return "managed";
  const hasPreferred = (override?.preferredCandidateId && candidates.some((candidate) => candidate.id === override.preferredCandidateId)) || (override?.preferredSourceId && candidates.some((candidate) => candidate.sourceId === override.preferredSourceId));
  if (candidates.length > 1 && !hasPreferred) return "conflict";
  if (hasPreferred) return "managed";
  if (candidates.every((candidate) => candidate.origin === "global-dir" || candidate.origin === "agent-dir")) return "discovered";
  return "managed";
}

function buildIssues(skills: Record<string, SkillRecord>, installations: IndexFile["installations"]): IssueRecord[] {
  const issues: IssueRecord[] = [];
  for (const skill of Object.values(skills)) {
    if (skill.status === "conflict") issues.push({ id: `skill-conflict:${skill.name}`, severity: "warning", kind: "skill-conflict", message: `Skill ${skill.name} has multiple candidates`, ref: skill.name });
  }
  for (const installation of Object.values(installations)) {
    if (installation.status === "broken-link") issues.push({ id: `broken-link:${installation.id}`, severity: "warning", kind: "broken-link", message: `Broken symlink: ${installation.targetPath}`, ref: installation.id });
    if (installation.status === "conflict") issues.push({ id: `install-conflict:${installation.id}`, severity: "warning", kind: "install-conflict", message: `Installation conflict: ${installation.targetPath}`, ref: installation.id });
  }
  return issues;
}
