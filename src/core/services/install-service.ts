import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../models/config.js";
import type { IndexFile } from "../models/index.js";
import type { InstallationRecord } from "../models/installation.js";
import type { InstallAction, InstallPlan, RepairPlan, UninstallPlan } from "../models/install-plan.js";
import type { SkillCandidate, SkillRecord } from "../models/skill.js";
import { createEmptyState, type InstalledSkillRecord, type StateFile } from "../models/state.js";
import type { StateStore } from "../storage/state-store.js";
import { ensureDir, pathExists } from "../../utils/fs.js";
import { resolveConfiguredPath } from "../../utils/path.js";
import { sha256Directory } from "../../utils/hash.js";
import {
  copySkillDirToSsot,
  createInstalledAgentRecord,
  createInstalledRecordFromCandidate,
  getSsotRoot,
  getSsotSkillPath,
  readSkillMetadata,
  replaceSymlinkToSsot,
  safeLstat,
  samePath
} from "./ssot-service.js";
import { assertPathInside, safeJoin } from "../../utils/safe-path.js";
import { bizError } from "../errors.js";

export async function detectInstallations(config: AppConfig, skills: Record<string, SkillRecord>, state: StateFile = createEmptyState()): Promise<Record<string, InstallationRecord>> {
  const records: Record<string, InstallationRecord> = {};
  for (const skill of Object.values(skills)) {
    for (const [agentId, agent] of Object.entries(config.agents)) {
      if (!agent.enabled) continue;
      const record = await detectInstallation(skill, agentId, resolveConfiguredPath(agent.skills_dir), state.installedSkills[skill.name]);
      if (record) records[record.id] = record;
    }
  }
  return records;
}

/**
 * installations 是 state.enabledAgents 的 symlink 健康投影：status 只表达 symlink 健康度
 * （installed/missing/broken-link/conflict/external），不再表达「是否 enabled」。
 * 未声明 enabled 且 target 不存在时返回 undefined（available 隐含，不写入 installations）。
 */
export async function detectInstallation(skill: SkillRecord, agentId: string, skillsDir: string, installed?: InstalledSkillRecord): Promise<InstallationRecord | undefined> {
  const targetPath = safeJoin(skillsDir, skill.name, "agent skill path");
  const expected = installed?.ssotPath ?? selectCandidate(skill)?.path;
  const base = { id: `${skill.name}:${agentId}`, skillName: skill.name, agentId, targetPath, expectedLinkTarget: expected };
  const expectedEnabled = Boolean(installed?.enabledAgents[agentId]);
  const lstat = await safeLstat(targetPath);
  if (!lstat) return expectedEnabled ? { ...base, status: "missing", reason: "enabled agent symlink is missing" } : undefined;
  if (lstat.isSymbolicLink()) {
    const linkTargetRaw = await fs.readlink(targetPath);
    const linkTarget = path.resolve(path.dirname(targetPath), linkTargetRaw);
    if (!(await pathExists(linkTarget))) return { ...base, status: "broken-link", linkTarget, reason: "symlink target is missing" };
    if (expected && samePath(linkTarget, expected)) {
      return expectedEnabled
        ? { ...base, status: "installed", linkTarget }
        : { ...base, status: "external", linkTarget, reason: "symlink points to SSOT but agent is not enabled in state" };
    }
    if (installed) return { ...base, status: "external", linkTarget, reason: "symlink points outside ASM SSOT" };
    if (skill.candidates.some((candidate) => samePath(candidate.path, linkTarget))) return { ...base, status: "conflict", linkTarget, reason: "symlink points to another candidate" };
    return { ...base, status: "external", linkTarget, reason: "symlink points outside indexed candidates" };
  }
  if (lstat.isDirectory()) {
    return (await pathExists(path.join(targetPath, "SKILL.md")))
      ? { ...base, status: "external", reason: "target is a real skill directory" }
      : { ...base, status: "conflict", reason: "target is a real directory without SKILL.md" };
  }
  return { ...base, status: "conflict", reason: "target exists and is not a directory or symlink" };
}

export async function buildInstallPlan(config: AppConfig, index: IndexFile, skillName: string, agentId: string, state: StateFile = createEmptyState()): Promise<InstallPlan> {
  const skill = index.skills[skillName];
  if (!skill) throw bizError("SKILL_NOT_FOUND", { name: skillName }, `Skill not found: ${skillName}`);
  const existing = state.installedSkills[skillName];
  if (existing) assertPathInside(getSsotRoot(config), existing.ssotPath, "installed SSOT path");
  const candidate = selectCandidate(skill) ?? skill.candidates[0];
  const agent = config.agents[agentId];
  if (!agent) throw bizError("AGENT_NOT_FOUND", { id: agentId }, `Agent not found: ${agentId}`);
  const warnings: string[] = [];
  const actions: InstallAction[] = [];
  const ssotPath = existing?.ssotPath ?? getSsotSkillPath(config, skill.name);

  if (skill.status === "conflict" && !existing) {
    actions.push({ type: "conflict", agentId, targetPath: safeJoin(resolveConfiguredPath(agent.skills_dir), skill.name, "agent skill path"), reason: `multiple source candidates; run \`skill add ${skillName} --source <id>\` first` });
    return makePlan(skill, candidate, ssotPath, actions, warnings);
  }
  if (!agent.enabled) {
    actions.push({ type: "conflict", agentId, targetPath: skill.name, reason: "agent is disabled" });
    return makePlan(skill, candidate, ssotPath, actions, warnings);
  }

  let record = existing;
  if (!record) {
    if (!candidate) throw bizError("NO_INSTALLABLE_CANDIDATE", { name: skillName }, `No installable candidate for skill: ${skillName}`);
    if (!(await pathExists(candidate.path))) {
      actions.push({ type: "conflict", agentId, targetPath: candidate.path, reason: "source skill is missing" });
      return makePlan(skill, candidate, ssotPath, actions, warnings);
    }
    if (await pathExists(ssotPath)) {
      actions.push({ type: "conflict", agentId, targetPath: ssotPath, reason: "SSOT target exists without installed state" });
      return makePlan(skill, candidate, ssotPath, actions, warnings);
    }
    actions.push({ type: "copy-to-ssot", sourcePath: candidate.path, targetPath: ssotPath, replace: false });
    record = await createPlannedRecord(config, candidate, ssotPath, existing);
  } else if (!(await pathExists(record.ssotPath))) {
    if (!candidate) {
      actions.push({ type: "conflict", agentId, targetPath: record.ssotPath, reason: "installed SSOT path is missing and no source candidate is available" });
      return makePlan(skill, candidate, ssotPath, actions, warnings);
    }
    actions.push({ type: "copy-to-ssot", sourcePath: candidate.path, targetPath: record.ssotPath, replace: true });
    record = await createPlannedRecord(config, candidate, record.ssotPath, existing);
  }

  const targetPath = safeJoin(resolveConfiguredPath(agent.skills_dir), skill.name, "agent skill path");
  const lstat = await safeLstat(targetPath);
  if (!lstat) {
    actions.push({ type: "create-symlink", agentId, targetPath, linkTarget: record.ssotPath });
  } else if (lstat.isSymbolicLink()) {
    const linkTarget = path.resolve(path.dirname(targetPath), await fs.readlink(targetPath));
    if (samePath(linkTarget, record.ssotPath)) actions.push({ type: "skip", agentId, targetPath, reason: "same SSOT symlink already installed" });
    else actions.push({ type: "conflict", agentId, targetPath, reason: `target symlink points to ${linkTarget}` });
  } else {
    actions.push({ type: "conflict", agentId, targetPath, reason: "target exists and is not a managed symlink" });
  }

  const nextRecord = {
    ...record,
    enabledAgents: {
      ...record.enabledAgents,
      [agentId]: record.enabledAgents[agentId] ?? createInstalledAgentRecord(agentId, targetPath)
    }
  };
  actions.push({ type: "update-state", record: nextRecord, agentId });
  return makePlan(skill, candidate, record.ssotPath, actions, warnings);
}

export async function applyInstallPlan(plan: InstallPlan, stateStore?: StateStore): Promise<void> {
  if (plan.hasConflict) throw bizError("INSTALL_PLAN_CONFLICT", {}, "Install plan has conflicts");
  for (const action of plan.actions) {
    if (action.type === "copy-to-ssot") await copySkillDirToSsot(action.sourcePath, action.targetPath, { replace: action.replace });
    else if (action.type === "create-symlink") {
      await ensureDir(path.dirname(action.targetPath));
      await fs.symlink(action.linkTarget, action.targetPath, "dir");
    } else if (action.type === "update-state" && stateStore) {
      const state = await stateStore.read();
      const metadata = await readSkillMetadata(action.record.ssotPath, action.record.skillName);
      state.installedSkills[action.record.skillName] = {
        ...action.record,
        displayName: metadata.displayName,
        description: metadata.description,
        tags: metadata.tags,
        contentHash: await sha256Directory(action.record.ssotPath),
        updatedAt: new Date().toISOString()
      };
      await stateStore.write(state);
    }
  }
}

export async function buildUninstallPlan(config: AppConfig, skillName: string, agentId: string, state: StateFile = createEmptyState()): Promise<UninstallPlan> {
  const agent = config.agents[agentId];
  if (!agent) throw bizError("AGENT_NOT_FOUND", { id: agentId }, `Agent not found: ${agentId}`);
  const targetPath = safeJoin(resolveConfiguredPath(agent.skills_dir), skillName, "agent skill path");
  const lstat = await safeLstat(targetPath);
  const actions: InstallAction[] = [];
  const record = state.installedSkills[skillName];
  if (!lstat) actions.push({ type: "skip", agentId, targetPath, reason: "target missing" });
  else if (lstat.isSymbolicLink()) actions.push({ type: "remove-symlink", agentId, targetPath });
  else actions.push({ type: "conflict", agentId, targetPath, reason: "refuse to remove real directory or file" });

  if (record) {
    const nextRecord = { ...record, enabledAgents: { ...record.enabledAgents } };
    delete nextRecord.enabledAgents[agentId];
    actions.push({ type: "update-state", record: nextRecord, removeAgentId: agentId });
  }
  return { id: `uninstall:${skillName}:${agentId}:${Date.now()}`, skillName, actions, hasConflict: actions.some((action) => action.type === "conflict"), warnings: [] };
}

export async function applyUninstallPlan(plan: UninstallPlan, stateStore?: StateStore): Promise<void> {
  if (plan.hasConflict) throw bizError("UNINSTALL_PLAN_CONFLICT", {}, "Uninstall plan has conflicts");
  for (const action of plan.actions) {
    if (action.type === "remove-symlink") await fs.unlink(action.targetPath);
    else if (action.type === "update-state" && stateStore) {
      const state = await stateStore.read();
      state.installedSkills[action.record.skillName] = action.record;
      await stateStore.write(state);
    }
  }
}

/**
 * 构建 broken-link 修复 plan：新模型优先修到 state 中的 SSOT；无 state 时保留旧 candidate 语义。
 */
export async function buildRepairPlan(config: AppConfig, index: IndexFile, skillName: string, agentId: string, state: StateFile = createEmptyState()): Promise<RepairPlan> {
  const skill = index.skills[skillName];
  if (!skill) throw bizError("SKILL_NOT_FOUND", { name: skillName }, `Skill not found: ${skillName}`);
  const agent = config.agents[agentId];
  if (!agent) throw bizError("AGENT_NOT_FOUND", { id: agentId }, `Agent not found: ${agentId}`);

  const targetPath = safeJoin(resolveConfiguredPath(agent.skills_dir), skill.name, "agent skill path");
  const candidate = selectCandidate(skill);
  const installed = state.installedSkills[skillName];
  if (installed) assertPathInside(getSsotRoot(config), installed.ssotPath, "installed SSOT path");
  const newTarget = installed?.ssotPath ?? candidate?.path;
  const warnings: string[] = [];
  const base = { id: `repair:${skillName}:${agentId}:${Date.now()}`, skillName, agentId, targetPath };

  if (!newTarget) return { ...base, newTarget: "", hasConflict: true, warnings: ["no SSOT record or preferred candidate for skill"] };
  if (!agent.enabled) return { ...base, newTarget, hasConflict: true, warnings: ["agent is disabled"] };
  if (!(await pathExists(newTarget))) return { ...base, newTarget, hasConflict: true, warnings: ["repair target is missing"] };

  const lstat = await safeLstat(targetPath);
  if (!lstat) return { ...base, newTarget, hasConflict: true, warnings: ["target does not exist (nothing to repair)"] };
  if (lstat.isSymbolicLink()) return { ...base, newTarget, hasConflict: false, warnings };
  return { ...base, newTarget, hasConflict: true, warnings: ["target is a real directory or file"] };
}

export async function applyRepairPlan(plan: RepairPlan): Promise<void> {
  if (plan.hasConflict) throw bizError("REPAIR_PLAN_CONFLICT", {}, "Repair plan has conflicts");
  const lstat = await safeLstat(plan.targetPath);
  if (!lstat) throw bizError("REPAIR_TARGET_MISSING", { path: plan.targetPath }, `Repair target does not exist: ${plan.targetPath}`);
  if (!lstat.isSymbolicLink()) throw bizError("REPAIR_TARGET_NOT_SYMLINK", { path: plan.targetPath }, `Repair target is not a symlink (refusing to delete real directory or file): ${plan.targetPath}`);
  await replaceSymlinkToSsot(plan.targetPath, plan.newTarget);
}

export function selectCandidate(skill: SkillRecord): SkillCandidate | undefined {
  if (skill.candidates.length === 1) return skill.candidates[0];
  return undefined;
}

function makePlan(skill: SkillRecord, candidate: SkillCandidate | undefined, sourcePath: string, actions: InstallAction[], warnings: string[]): InstallPlan {
  return { id: `install:${skill.name}:${Date.now()}`, skillName: skill.name, sourceCandidateId: candidate?.id ?? "installed-state", sourcePath, actions, hasConflict: actions.some((action) => action.type === "conflict"), warnings };
}

async function createPlannedRecord(config: AppConfig, candidate: SkillCandidate, ssotPath: string, existing?: InstalledSkillRecord): Promise<InstalledSkillRecord> {
  await ensureDir(path.dirname(ssotPath));
  if (!(await pathExists(ssotPath))) {
    // Record metadata is recalculated after copy during apply; use candidate fields for dry-run planning.
    const now = new Date().toISOString();
    const source = config.sources.find((entry) => entry.id === candidate.sourceId) ?? {
      id: candidate.sourceId,
      name: candidate.sourceId,
      type: candidate.sourceType,
      path: candidate.path,
      enabled: true
    };
    const sourcePath = resolveConfiguredPath(source.path);
    const relative = path.relative(sourcePath, resolveConfiguredPath(candidate.path));
    return {
      skillName: candidate.skillName,
      displayName: candidate.skillName,
      description: candidate.description,
      tags: candidate.tags,
      ssotPath,
      source: {
        kind: "configured-source",
        sourceId: source.id,
        sourceType: source.type,
        sourcePath,
        relativePath: relative ? relative.split(path.sep).join("/") : ".",
        url: source.url,
        branch: source.branch
      },
      contentHash: candidate.hash,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
      enabledAgents: existing?.enabledAgents ?? {}
    };
  }
  return createInstalledRecordFromCandidate(config, candidate, existing);
}
