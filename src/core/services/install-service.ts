import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../models/config.js";
import type { IndexFile } from "../models/index.js";
import type { InstallationRecord } from "../models/installation.js";
import type { InstallAction, InstallPlan, RepairPlan, UninstallPlan } from "../models/install-plan.js";
import type { SkillCandidate, SkillRecord } from "../models/skill.js";
import { ensureDir, pathExists } from "../../utils/fs.js";
import { resolveConfiguredPath } from "../../utils/path.js";

export async function detectInstallations(config: AppConfig, skills: Record<string, SkillRecord>): Promise<Record<string, InstallationRecord>> {
  const records: Record<string, InstallationRecord> = {};
  for (const skill of Object.values(skills)) {
    for (const [agentId, agent] of Object.entries(config.agents)) {
      const record = await detectInstallation(skill, agentId, agent.enabled ? resolveConfiguredPath(agent.skills_dir) : undefined);
      records[record.id] = record;
    }
  }
  return records;
}

export async function detectInstallation(skill: SkillRecord, agentId: string, skillsDir?: string): Promise<InstallationRecord> {
  const targetPath = skillsDir ? path.join(skillsDir, skill.name) : skill.name;
  const expected = selectCandidate(skill)?.path;
  const base = { id: `${skill.name}:${agentId}`, skillName: skill.name, agentId, targetPath, expectedLinkTarget: expected };
  if (!skillsDir) return { ...base, status: "unsupported", reason: "agent disabled" };
  const lstat = await safeLstat(targetPath);
  if (!lstat) return { ...base, status: "available" };
  if (lstat.isSymbolicLink()) {
    const linkTargetRaw = await fs.readlink(targetPath);
    const linkTarget = path.resolve(path.dirname(targetPath), linkTargetRaw);
    if (!(await pathExists(linkTarget))) return { ...base, status: "broken-link", linkTarget, reason: "symlink target is missing" };
    if (expected && samePath(linkTarget, expected)) return { ...base, status: "installed", linkTarget, installedCandidateId: selectCandidate(skill)?.id };
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

export async function buildInstallPlan(config: AppConfig, index: IndexFile, skillName: string, agentId: string): Promise<InstallPlan> {
  const skill = index.skills[skillName];
  if (!skill) throw new Error(`Skill not found: ${skillName}`);
  const candidate = selectCandidate(skill) ?? skill.candidates[0];
  if (!candidate) throw new Error(`No installable candidate for skill: ${skillName}`);
  const agent = config.agents[agentId];
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  const warnings: string[] = [];
  const actions: InstallAction[] = [];
  if (skill.status === "conflict" && !skill.preferredCandidateId && !skill.preferredSourceId) {
    actions.push({ type: "conflict", agentId, targetPath: path.join(resolveConfiguredPath(agent.skills_dir), skill.name), reason: "multiple candidates require a preferred source" });
    return makePlan(skill, candidate, actions, warnings);
  }
  if (!agent.enabled) {
    actions.push({ type: "conflict", agentId, targetPath: skill.name, reason: "agent is disabled" });
    return makePlan(skill, candidate, actions, warnings);
  }
  if (!(await pathExists(candidate.path))) {
    actions.push({ type: "conflict", agentId, targetPath: candidate.path, reason: "source skill is missing" });
    return makePlan(skill, candidate, actions, warnings);
  }
  const targetPath = path.join(resolveConfiguredPath(agent.skills_dir), skill.name);
  const lstat = await safeLstat(targetPath);
  if (!lstat) actions.push({ type: "create-symlink", agentId, targetPath, linkTarget: candidate.path });
  else if (lstat.isSymbolicLink()) {
    const linkTarget = path.resolve(path.dirname(targetPath), await fs.readlink(targetPath));
    if (samePath(linkTarget, candidate.path)) actions.push({ type: "skip", agentId, targetPath, reason: "same symlink already installed" });
    else actions.push({ type: "conflict", agentId, targetPath, reason: `target symlink points to ${linkTarget}` });
  } else {
    actions.push({ type: "conflict", agentId, targetPath, reason: "target exists and is not a managed symlink" });
  }
  return makePlan(skill, candidate, actions, warnings);
}

export async function applyInstallPlan(plan: InstallPlan): Promise<void> {
  if (plan.hasConflict) throw new Error("Install plan has conflicts");
  for (const action of plan.actions) {
    if (action.type !== "create-symlink") continue;
    await ensureDir(path.dirname(action.targetPath));
    await fs.symlink(action.linkTarget, action.targetPath, "dir");
  }
}

export async function buildUninstallPlan(config: AppConfig, skillName: string, agentId: string): Promise<UninstallPlan> {
  const agent = config.agents[agentId];
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  const targetPath = path.join(resolveConfiguredPath(agent.skills_dir), skillName);
  const lstat = await safeLstat(targetPath);
  const actions: InstallAction[] = [];
  if (!lstat) actions.push({ type: "skip", agentId, targetPath, reason: "target missing" });
  else if (lstat.isSymbolicLink()) actions.push({ type: "skip", agentId, targetPath, reason: "remove symlink" });
  else actions.push({ type: "conflict", agentId, targetPath, reason: "refuse to remove real directory or file" });
  return { id: `uninstall:${skillName}:${agentId}:${Date.now()}`, skillName, actions, hasConflict: actions.some((action) => action.type === "conflict"), warnings: [] };
}

export async function applyUninstallPlan(plan: UninstallPlan): Promise<void> {
  if (plan.hasConflict) throw new Error("Uninstall plan has conflicts");
  for (const action of plan.actions) {
    if (action.type === "skip" && action.reason === "remove symlink" && action.targetPath) await fs.unlink(action.targetPath);
  }
}

/**
 * 构建 broken-link 修复 plan：解析 agent.skills_dir/skillName 为 targetPath，
 * 用 selectCandidate 得到 newTarget。仅当 target 当前是 symlink 时可修（hasConflict=false）；
 * 真实目录/文件、目标不存在、agent disabled 或无 candidate 时 hasConflict=true 并以 warnings 说明。
 */
export async function buildRepairPlan(config: AppConfig, index: IndexFile, skillName: string, agentId: string): Promise<RepairPlan> {
  const skill = index.skills[skillName];
  if (!skill) throw new Error(`Skill not found: ${skillName}`);
  const agent = config.agents[agentId];
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  const targetPath = path.join(resolveConfiguredPath(agent.skills_dir), skill.name);
  const candidate = selectCandidate(skill);
  const warnings: string[] = [];
  const base = { id: `repair:${skillName}:${agentId}:${Date.now()}`, skillName, agentId, targetPath };

  if (!candidate) return { ...base, newTarget: "", hasConflict: true, warnings: ["no preferred candidate for skill"] };
  if (!agent.enabled) return { ...base, newTarget: candidate.path, hasConflict: true, warnings: ["agent is disabled"] };
  if (!(await pathExists(candidate.path))) return { ...base, newTarget: candidate.path, hasConflict: true, warnings: ["source skill is missing"] };

  const lstat = await safeLstat(targetPath);
  if (!lstat) return { ...base, newTarget: candidate.path, hasConflict: true, warnings: ["target does not exist (nothing to repair)"] };
  if (lstat.isSymbolicLink()) return { ...base, newTarget: candidate.path, hasConflict: false, warnings };
  return { ...base, newTarget: candidate.path, hasConflict: true, warnings: ["target is a real directory or file"] };
}

/**
 * 应用修复 plan：hasConflict 时抛错；否则 unlink 旧 symlink 后重建指向 newTarget 的新 symlink。
 * 防御性安全：unlink 前再 lstat 确认是 symlink，真实目录/文件拒绝删除；ENOENT 视为缺失并抛出清晰错误。
 */
export async function applyRepairPlan(plan: RepairPlan): Promise<void> {
  if (plan.hasConflict) throw new Error("Repair plan has conflicts");
  const lstat = await safeLstat(plan.targetPath);
  if (!lstat) throw new Error(`Repair target does not exist: ${plan.targetPath}`);
  if (!lstat.isSymbolicLink()) throw new Error(`Repair target is not a symlink (refusing to delete real directory or file): ${plan.targetPath}`);
  await fs.unlink(plan.targetPath);
  await ensureDir(path.dirname(plan.targetPath));
  await fs.symlink(plan.newTarget, plan.targetPath, "dir");
}

export function selectCandidate(skill: SkillRecord): SkillCandidate | undefined {
  if (skill.preferredCandidateId) return skill.candidates.find((candidate) => candidate.id === skill.preferredCandidateId);
  if (skill.preferredSourceId) return skill.candidates.find((candidate) => candidate.sourceId === skill.preferredSourceId);
  if (skill.candidates.length === 1) return skill.candidates[0];
  return undefined;
}

function makePlan(skill: SkillRecord, candidate: SkillCandidate, actions: InstallAction[], warnings: string[]): InstallPlan {
  return { id: `install:${skill.name}:${Date.now()}`, skillName: skill.name, sourceCandidateId: candidate.id, sourcePath: candidate.path, actions, hasConflict: actions.some((action) => action.type === "conflict"), warnings };
}

async function safeLstat(filePath: string) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}
