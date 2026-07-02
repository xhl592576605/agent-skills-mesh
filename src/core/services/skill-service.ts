import fs from "node:fs/promises";
import path from "node:path";
import type { IndexFile } from "../models/index.js";
import type { SkillRecord } from "../models/skill.js";
import type { SourceConfig } from "../models/config.js";
import { ConfigStore } from "../storage/config-store.js";
import type { IndexStore } from "../storage/index-store.js";
import { ensureDir, pathExists, removeRecursive } from "../../utils/fs.js";
import { resolveConfiguredPath } from "../../utils/path.js";
import { dedupeId, slugify } from "./source-service.js";

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

/** 注册单个 skill 目录为 `single-skill` source；校验 `dirPath/SKILL.md` 存在。 */
export async function addSingleSkill(configStore: ConfigStore, dirPath: string, options: { id?: string } = {}): Promise<SourceConfig> {
  const resolved = resolveConfiguredPath(dirPath);
  if (!(await pathExists(path.join(resolved, "SKILL.md")))) {
    throw new Error(`Not a skill directory (missing SKILL.md): ${resolved}`);
  }
  const config = await configStore.read();
  const duplicate = config.sources.find((source) => resolveConfiguredPath(source.path) === resolved);
  if (duplicate) throw new Error(`Source already registered: id=${duplicate.id} path=${duplicate.path}`);

  const id = resolveSkillId(config, options.id, slugify(dirPath));
  const source: SourceConfig = {
    id,
    name: path.basename(resolved),
    type: "single-skill",
    path: resolved,
    enabled: true,
    readonly: false
  };
  config.sources.push(source);
  await configStore.write(config);
  return source;
}

/** 完整目录拷贝到 `local/<name>/`，注册为 `single-skill` source 指向 local 路径；拷贝失败回滚。 */
export async function importSkill(configStore: ConfigStore, dirPath: string, options: { id?: string } = {}): Promise<SourceConfig> {
  const resolved = resolveConfiguredPath(dirPath);
  if (!(await pathExists(path.join(resolved, "SKILL.md")))) {
    throw new Error(`Not a skill directory (missing SKILL.md): ${resolved}`);
  }
  const config = await configStore.read();
  const name = path.basename(resolved);
  const id = resolveSkillId(config, options.id, slugify(dirPath));

  const localDir = resolveConfiguredPath(config.paths.local);
  const dest = path.join(localDir, name);
  if (await pathExists(dest)) throw new Error(`Import target already exists: ${dest}`);

  const source: SourceConfig = {
    id,
    name,
    type: "single-skill",
    path: dest,
    enabled: true,
    readonly: false
  };

  await ensureDir(localDir);
  try {
    await fs.cp(resolved, dest, { recursive: true });
    config.sources.push(source);
    await configStore.write(config);
  } catch (error) {
    await safeCleanup(dest);
    throw error;
  }
  return source;
}

/** 为同名多来源 skill 设置 preferred source；校验 sourceId 存在且确实提供该 skill 的 candidate。 */
export async function preferSkill(configStore: ConfigStore, indexStore: IndexStore, skillName: string, sourceId: string): Promise<void> {
  const config = await configStore.read();
  if (!config.sources.some((source) => source.id === sourceId)) {
    throw new Error(`Unknown source id: ${sourceId}`);
  }
  const index = await indexStore.read();
  const skill = index.skills[skillName];
  if (!skill) throw new Error(`Skill not found: ${skillName}`);
  if (!skill.candidates.some((candidate) => candidate.sourceId === sourceId)) {
    throw new Error(`Source ${sourceId} does not provide skill ${skillName}`);
  }

  config.skillOverrides = {
    ...config.skillOverrides,
    [skillName]: { ...config.skillOverrides[skillName], preferredSourceId: sourceId }
  };
  await configStore.write(config);
}

function resolveSkillId(config: Parameters<typeof dedupeId>[0], custom: string | undefined, fallback: string): string {
  const id = custom ?? dedupeId(config, fallback);
  if (config.sources.some((source) => source.id === id)) {
    throw new Error(`Source id already exists: ${id}`);
  }
  return id;
}

async function safeCleanup(target: string): Promise<void> {
  try {
    await removeRecursive(target);
  } catch {
    // best-effort：回滚清理半成品目录，失败不阻塞主错误。
  }
}
