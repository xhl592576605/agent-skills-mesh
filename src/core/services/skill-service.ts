import fs from "node:fs/promises";
import path from "node:path";
import type { IndexFile } from "../models/index.js";
import type { AppConfig } from "../models/config.js";
import type { SkillRecord } from "../models/skill.js";
import type { InstalledSkillRecord, StateFile } from "../models/state.js";
import { ConfigStore } from "../storage/config-store.js";
import type { StateStore } from "../storage/state-store.js";
import { pathExists } from "../../utils/fs.js";
import { resolveConfiguredPath } from "../../utils/path.js";
import { sha256Directory } from "../../utils/hash.js";
import { assertPathInside, assertSafeSkillName, safeJoin } from "../../utils/safe-path.js";
import {
  copySkillDirToSsot,
  createInstalledRecordFromCandidate,
  detachAgentSymlinks,
  ensureSymlinkToSsot,
  getSsotRoot,
  getSsotSkillPath,
  installedSourceFromCandidate,
  readSkillMetadata
} from "./ssot-service.js";
import { resolveSourceSkillDir } from "./source-service.js";

/**
 * 按 keyword 子串过滤 index 中的 skills（匹配 name/displayName/description/tags，大小写不敏感）。
 * 空 keyword（或纯空白）返回全部 skill，按 name 排序。
 */
export function searchSkills(index: IndexFile, keyword: string): SkillRecord[] {
  const needle = keyword.trim().toLowerCase();
  const skills = Object.values(index.skills).sort((a, b) => a.name.localeCompare(b.name));
  if (!needle) return skills;
  return skills.filter((skill) => {
    if (skill.name.toLowerCase().includes(needle)) return true;
    if (skill.displayName.toLowerCase().includes(needle)) return true;
    if (skill.description?.toLowerCase().includes(needle)) return true;
    if (skill.tags.some((tag) => tag.toLowerCase().includes(needle))) return true;
    return false;
  });
}

/**
 * 从 source 复制 skill 进 SSOT 并写 state（R6：替代旧 import + 注册 source 的 skill add）。
 * 同名多 source 候选必须用 `--source` 选定，否则报 conflict。复用 copySkillDirToSsot（安全复制）+
 * createInstalledRecordFromCandidate（建 InstalledSkillRecord）。
 */
export async function skillAdd(configStore: ConfigStore, stateStore: StateStore, index: IndexFile, name: string, options: { source?: string } = {}): Promise<InstalledSkillRecord> {
  const config = await configStore.read();
  const state = await stateStore.read();
  if (state.installedSkills[name]) throw new Error(`Skill already installed: ${name}`);
  const skill = index.skills[name];
  if (!skill) throw new Error(`Skill not found in index: ${name} (run \`asm refresh\` first)`);

  const liveSourceIds = new Set(config.sources.map((source) => source.id));
  if (options.source && !liveSourceIds.has(options.source)) throw new Error(`Unknown source id: ${options.source}`);
  let candidates = skill.candidates.filter((candidate) => candidate.origin === "configured-source" && liveSourceIds.has(candidate.sourceId));
  if (options.source) candidates = candidates.filter((candidate) => candidate.sourceId === options.source);
  if (candidates.length === 0) throw new Error(`No candidate for skill ${name}${options.source ? ` from source ${options.source}` : ""}`);
  if (candidates.length > 1) throw new Error(`Multiple candidates for ${name}: ${candidates.map((candidate) => candidate.sourceId).join(", ")}; specify --source <id>`);

  const candidate = candidates[0];
  assertSafeSkillName(name);
  const ssotPath = getSsotSkillPath(config, name);
  await copySkillDirToSsot(candidate.path, ssotPath, { replace: false });
  const record = await createInstalledRecordFromCandidate(config, candidate);
  state.installedSkills[name] = record;
  await stateStore.write(state);
  return record;
}

/**
 * 把孤儿或任意 installed skill 重新关联到新 source（R5 显式 rebind）。校验目标 source 存在且提供同名
 * candidate 后，重写 state.source 的逻辑坐标（sourceId/sourceType/sourcePath/relativePath/url/branch），
 * 恢复 skill update 能力。
 */
export async function skillRebind(configStore: ConfigStore, stateStore: StateStore, index: IndexFile, name: string, sourceId: string): Promise<void> {
  const config = await configStore.read();
  const state = await stateStore.read();
  const record = state.installedSkills[name];
  if (!record) throw new Error(`Skill not installed: ${name}`);
  const source = config.sources.find((entry) => entry.id === sourceId);
  if (!source) throw new Error(`Unknown source id: ${sourceId}`);
  const skill = index.skills[name];
  if (!skill) throw new Error(`Skill not found in index: ${name} (run \`asm refresh\` first)`);
  const candidate = skill.candidates.find((entry) => entry.sourceId === sourceId);
  if (!candidate) throw new Error(`Source ${sourceId} does not provide skill ${name}`);
  if (candidate.origin !== "configured-source") throw new Error(`Source ${sourceId} candidate is not a configured-source`);
  // 校验 candidate.path 在当前 source.path 内，防 index 陈旧/source id 复用导致 relativePath 逃逸。
  assertPathInside(resolveConfiguredPath(source.path), resolveConfiguredPath(candidate.path), "rebind candidate path");

  record.source = installedSourceFromCandidate(source, candidate);
  record.updatedAt = new Date().toISOString();
  await stateStore.write(state);
}

/**
 * 从 SSOT 删除 skill：删 SSOT 目录 + 断所有 agent symlink（仅删经校验的 symlink）+ 删 state record。
 * SSOT 删除失败抛错（保持一致）；symlink 删除 best-effort。
 */
export async function skillRemove(configStore: ConfigStore, stateStore: StateStore, name: string): Promise<void> {
  const config = await configStore.read();
  const state = await stateStore.read();
  const record = state.installedSkills[name];
  if (!record) throw new Error(`Skill not installed: ${name}`);
  assertPathInside(getSsotRoot(config), record.ssotPath, "installed SSOT path");

  await detachAgentSymlinks(config, record);

  await fs.rm(record.ssotPath, { recursive: true, force: true });
  delete state.installedSkills[name];
  await stateStore.write(state);
}

export interface SkillUpdateReport {
  skillName: string;
  success: boolean;
  error?: string;
  oldHash?: string;
  newHash?: string;
}

/**
 * 显式把 SSOT 内容更新到 source 最新版（R3 两步分离的第二步）。流程：
 * 校验 installed 且非 orphan → 定位 source skill 目录 → hash 预检（一致则 no-op）→
 * 安全替换 SSOT（temp+backup+rename+rollback）→ 更新 state.contentHash/updatedAt/metadata
 * → best-effort 修复缺失的 enabled symlink。`--all` 遍历所有 installed managed skill；orphan 与 manual-import 失败并提示。
 */
export async function skillUpdate(configStore: ConfigStore, stateStore: StateStore, target: string): Promise<SkillUpdateReport[]> {
  const config = await configStore.read();
  const state = await stateStore.read();
  const names = target === "--all" ? Object.keys(state.installedSkills) : [target];
  const reports: SkillUpdateReport[] = [];
  for (const name of names) {
    reports.push(await updateOneSkill(config, state, name, stateStore));
  }
  return reports;
}

async function updateOneSkill(config: AppConfig, state: StateFile, name: string, stateStore: StateStore): Promise<SkillUpdateReport> {
  const record = state.installedSkills[name];
  if (!record) return { skillName: name, success: false, error: `Skill not installed: ${name}` };
  if (record.source.kind !== "configured-source") {
    return { skillName: name, success: false, error: `Skill ${name} has no configurable source (manual-import); nothing to update` };
  }
  const installedSource = record.source;
  const source = config.sources.find((entry) => entry.id === installedSource.sourceId);
  if (!source) {
    return { skillName: name, success: false, error: `Skill ${name} is orphan (source ${installedSource.sourceId} missing); run \`source add\` or \`skill rebind ${name} --source <id>\`` };
  }
  const sourceSkillDir = resolveSourceSkillDir(source, installedSource.relativePath);
  if (!(await pathExists(path.join(sourceSkillDir, "SKILL.md")))) {
    return { skillName: name, success: false, error: `Source skill missing: ${sourceSkillDir}` };
  }

  const oldHash = record.contentHash;
  const nextHash = await sha256Directory(sourceSkillDir);
  if (nextHash === oldHash) {
    return { skillName: name, success: true, oldHash, newHash: oldHash };
  }

  try {
    assertSafeSkillName(name);
    assertPathInside(getSsotRoot(config), record.ssotPath, "installed SSOT path");
    await copySkillDirToSsot(sourceSkillDir, record.ssotPath, { replace: true });
    const metadata = await readSkillMetadata(record.ssotPath, name);
    record.displayName = metadata.displayName;
    record.description = metadata.description;
    record.tags = metadata.tags;
    record.contentHash = await sha256Directory(record.ssotPath);
    record.updatedAt = new Date().toISOString();
    await stateStore.write(state);
    try {
      for (const agentRecord of Object.values(record.enabledAgents)) {
        const agent = config.agents[agentRecord.agentId];
        if (!agent) continue;
        const linkPath = safeJoin(resolveConfiguredPath(agent.skills_dir), name, "agent skill path");
        await ensureSymlinkToSsot(linkPath, record.ssotPath);
      }
    } catch {
      // best-effort：symlink 修复失败由 doctor 报告，不影响 update 成功。
    }
    return { skillName: name, success: true, oldHash, newHash: record.contentHash };
  } catch (error) {
    return { skillName: name, success: false, error: errorMessage(error), oldHash };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
