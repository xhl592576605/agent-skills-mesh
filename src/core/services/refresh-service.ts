import type { AppConfig, SourceConfig } from "../models/config.js";
import type { IndexFile, IssueRecord } from "../models/index.js";
import type { SkillCandidate, SkillRecord, SkillStatus } from "../models/skill.js";
import { createEmptyState, type StateFile } from "../models/state.js";
import { scanSource } from "../scanners/skill-scanner.js";
import { detectInstallations } from "./install-service.js";

export async function refreshIndex(config: AppConfig, state: StateFile = createEmptyState()): Promise<IndexFile> {
  const sources = buildRefreshSources(config);
  const candidates = (await Promise.all(sources.filter((source) => source.enabled).map(scanSource))).flat();
  const skills = mergeCandidates(candidates, config, state);
  // state 中纳管但本轮 source 扫描无 candidate 的 skill：installed → managed/orphan。
  // index 完全从 (config + state + fs) 重建，不读 previous（R11：可重建缓存）。
  for (const name of Object.keys(state.installedSkills)) {
    if (!skills[name]) skills[name] = buildSkillRecord(name, [], true, isOrphan(config, state, name));
  }
  const installations = await detectInstallations(config, skills, state);
  const issues = buildIssues(skills, installations, state);
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
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

export function mergeCandidates(candidates: SkillCandidate[], config: AppConfig, state: StateFile = createEmptyState()): Record<string, SkillRecord> {
  const groups = new Map<string, SkillCandidate[]>();
  for (const candidate of candidates) {
    groups.set(candidate.skillName, [...(groups.get(candidate.skillName) ?? []), candidate]);
  }
  const skills: Record<string, SkillRecord> = {};
  for (const [name, group] of groups) {
    skills[name] = buildSkillRecord(name, group, isInstalled(state, name), isOrphan(config, state, name));
  }
  return skills;
}

function buildSkillRecord(name: string, group: SkillCandidate[], installed: boolean, orphan: boolean): SkillRecord {
  const tags = [...new Set(group.flatMap((candidate) => candidate.tags))];
  return {
    name,
    displayName: name,
    description: group.find((candidate) => candidate.description)?.description,
    tags,
    status: calculateStatus(group, installed, orphan),
    candidates: group.sort((a, b) => a.path.localeCompare(b.path))
  };
}

/**
 * 状态判定（无 override，全部基于 state + candidates 实时派生）：
 * - installed + source 在 config → managed；installed + source 缺失 → orphan
 * - 未 installed + 多个 configured-source 候选 → conflict（需 `skill add --source` 选定）
 * - 未 installed + 有候选（单个 configured 或 agent-dir/global-dir）→ discovered（可纳管/外部发现）
 * - 无候选且未 installed → missing
 */
function calculateStatus(candidates: SkillCandidate[], installed: boolean, orphan: boolean): SkillStatus {
  if (installed) return orphan ? "orphan" : "managed";
  if (candidates.length === 0) return "missing";
  const configuredCount = candidates.filter((candidate) => candidate.origin === "configured-source").length;
  if (configuredCount > 1) return "conflict";
  return "discovered";
}

function isInstalled(state: StateFile, name: string): boolean {
  return Boolean(state.installedSkills[name]);
}

/** orphan = 已纳管且来源为 configured-source，但其 sourceId 已不在 config.sources（被 remove）。 */
function isOrphan(config: AppConfig, state: StateFile, name: string): boolean {
  const record = state.installedSkills[name];
  if (!record) return false;
  const source = record.source;
  if (source.kind !== "configured-source") return false;
  return !config.sources.some((entry) => entry.id === source.sourceId);
}

function buildIssues(skills: Record<string, SkillRecord>, installations: IndexFile["installations"], state: StateFile): IssueRecord[] {
  const issues: IssueRecord[] = [];
  for (const skill of Object.values(skills)) {
    if (skill.status === "conflict")
      issues.push({ id: `skill-conflict:${skill.name}`, severity: "warning", kind: "skill-conflict", message: `Skill ${skill.name} has multiple source candidates; run \`skill add ${skill.name} --source <id>\` to select`, ref: skill.name });
    if (skill.status === "orphan")
      issues.push({ id: `orphan:${skill.name}`, severity: "warning", kind: "orphan", message: `Skill ${skill.name} source is missing (orphan); run \`source add\` or \`skill rebind ${skill.name} --source <id>\``, ref: skill.name });
    const installed = state.installedSkills[skill.name];
    if (installed && skill.status !== "orphan") {
      const source = installed.source;
      if (source.kind === "configured-source" && !skill.candidates.some((candidate) => candidate.sourceId === source.sourceId)) {
        issues.push({ id: `installed-source-missing:${skill.name}`, severity: "warning", kind: "installed-source-missing", message: `Installed skill ${skill.name} source is missing from current scan`, ref: skill.name });
      }
    }
  }
  for (const installation of Object.values(installations)) {
    if (installation.status === "broken-link") issues.push({ id: `broken-link:${installation.id}`, severity: "warning", kind: "broken-link", message: `Broken symlink: ${installation.targetPath}`, ref: installation.id });
    if (installation.status === "conflict") issues.push({ id: `install-conflict:${installation.id}`, severity: "warning", kind: "install-conflict", message: `Installation conflict: ${installation.targetPath}`, ref: installation.id });
    if (installation.status === "missing") issues.push({ id: `install-missing:${installation.id}`, severity: "warning", kind: "install-missing", message: `Missing installed symlink: ${installation.targetPath}`, ref: installation.id });
  }
  return issues;
}
