import type { AppConfig, SourceConfig } from "../models/config.js";
import { createEmptyIndex, type IndexFile, type IssueRecord } from "../models/index.js";
import type { SkillCandidate, SkillRecord, SkillStatus } from "../models/skill.js";
import { scanSource } from "../scanners/skill-scanner.js";
import { detectInstallations } from "./install-service.js";

export async function refreshIndex(config: AppConfig, previous: IndexFile = createEmptyIndex()): Promise<IndexFile> {
  const sources = buildRefreshSources(config);
  const candidates = (await Promise.all(sources.filter((source) => source.enabled).map(scanSource))).flat();
  const skills = mergeCandidates(candidates, previous);
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

export function mergeCandidates(candidates: SkillCandidate[], previous: IndexFile = createEmptyIndex()): Record<string, SkillRecord> {
  const groups = new Map<string, SkillCandidate[]>();
  for (const candidate of candidates) {
    groups.set(candidate.skillName, [...(groups.get(candidate.skillName) ?? []), candidate]);
  }
  const skills: Record<string, SkillRecord> = {};
  for (const [name, group] of groups) {
    const old = previous.skills[name];
    const preferredCandidateId = old?.preferredCandidateId && group.some((candidate) => candidate.id === old.preferredCandidateId) ? old.preferredCandidateId : undefined;
    const preferredSourceId = old?.preferredSourceId && group.some((candidate) => candidate.sourceId === old.preferredSourceId) ? old.preferredSourceId : undefined;
    const status = calculateStatus(group, preferredCandidateId, preferredSourceId, old?.ignored);
    const tags = [...new Set(group.flatMap((candidate) => candidate.tags))];
    skills[name] = {
      name,
      displayName: name,
      description: group.find((candidate) => candidate.description)?.description,
      tags,
      status,
      preferredCandidateId,
      preferredSourceId,
      candidates: group.sort((a, b) => a.path.localeCompare(b.path)),
      ignored: old?.ignored
    };
  }
  for (const [name, old] of Object.entries(previous.skills)) {
    if (!skills[name]) skills[name] = { ...old, status: "missing", candidates: [] };
  }
  return skills;
}

function calculateStatus(candidates: SkillCandidate[], preferredCandidateId?: string, preferredSourceId?: string, ignored?: boolean): SkillStatus {
  if (ignored) return "ignored";
  if (candidates.length === 0) return "missing";
  if (candidates.length > 1 && !preferredCandidateId && !preferredSourceId) return "conflict";
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
