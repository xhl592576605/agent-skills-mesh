import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig, SourceConfig } from "../models/config.js";
import { ConfigStore } from "../storage/config-store.js";
import type { StateStore } from "../storage/state-store.js";
import type { StateFile } from "../models/state.js";
import { ensureDir, pathExists, removeRecursive } from "../../utils/fs.js";
import { resolveConfiguredPath, toPosixId } from "../../utils/path.js";
import { gitClone, gitPullFfOnly } from "../../utils/git.js";
import { sha256Directory } from "../../utils/hash.js";
import { copySkillDirToSsot, ensureSymlinkToSsot, getSsotRoot, readSkillMetadata } from "./ssot-service.js";
import { assertPathInside, assertSafeSkillName, safeJoin } from "../../utils/safe-path.js";

export interface SyncResult {
  sourceId: string;
  action: "clone" | "pull";
  success: boolean;
  error?: string;
  updatedSkills?: string[];
  skippedSkills?: string[];
  conflicts?: string[];
}

/** 取 path 或 git url（含 scp 语法 `host:x/y`）的最后一段，保留原大小写。 */
function lastSegment(input: string): string {
  const cleaned = input.replace(/\.git$/, "").replace(/[\\/:]+$/, "");
  const segments = cleaned.split(/[\\/:]/).filter(Boolean);
  return segments[segments.length - 1] ?? cleaned;
}

/** path/url basename → 合法 source id slug（小写 `[a-z0-9-]`，去首尾连字符）。 */
export function slugify(input: string): string {
  return toPosixId(lastSegment(input));
}

/** 在已有 source id 集合内对 base 去重，冲突追加 `-2`/`-3`。 */
export function dedupeId(config: AppConfig, base: string): string {
  const existing = new Set(config.sources.map((source) => source.id));
  if (!existing.has(base)) return base;
  let counter = 2;
  while (existing.has(`${base}-${counter}`)) counter++;
  return `${base}-${counter}`;
}

/** 纯读：返回 config.sources。 */
export function listSources(config: AppConfig): SourceConfig[] {
  return config.sources;
}

/** 注册本地目录为 `local-dir` source；重复 path 报错，不产生重复 source。 */
export async function addSource(configStore: ConfigStore, dirPath: string, options: { id?: string } = {}): Promise<SourceConfig> {
  const resolved = resolveConfiguredPath(dirPath);
  if (!(await pathExists(resolved))) throw new Error(`Source path does not exist: ${resolved}`);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) throw new Error(`Source path is not a directory: ${resolved}`);

  const config = await configStore.read();
  const duplicate = config.sources.find((source) => resolveConfiguredPath(source.path) === resolved);
  if (duplicate) throw new Error(`Source already registered: id=${duplicate.id} path=${duplicate.path}`);

  const id = resolveId(config, options.id, slugify(dirPath));
  const source: SourceConfig = {
    id,
    name: path.basename(resolved),
    type: "local-dir",
    path: resolved,
    enabled: true,
    readonly: false
  };
  config.sources.push(source);
  await configStore.write(config);
  return source;
}

/** clone git 仓库到 `repos/<id>`，成功后注册 `git-repo` source；clone 失败不写 config 并清理半成品。 */
export async function addRepoSource(configStore: ConfigStore, gitUrl: string, options: { id?: string; branch?: string } = {}): Promise<SourceConfig> {
  const config = await configStore.read();
  const dup = config.sources.find((source) => source.type === "git-repo" && source.url === gitUrl);
  if (dup) throw new Error(`Git repo already registered: id=${dup.id} url=${gitUrl}`);

  const id = resolveId(config, options.id, slugify(gitUrl));
  const reposDir = resolveConfiguredPath(config.paths.repos);
  const dest = path.join(reposDir, id);
  if (await pathExists(dest)) throw new Error(`Repo target already exists: ${dest}`);

  const source: SourceConfig = {
    id,
    name: lastSegment(gitUrl),
    type: "git-repo",
    path: dest,
    enabled: true,
    readonly: false,
    url: gitUrl,
    branch: options.branch
  };

  try {
    await ensureDir(reposDir);
    await gitClone(gitUrl, dest, { branch: options.branch });
    config.sources.push(source);
    await configStore.write(config);
  } catch (error) {
    await safeCleanup(dest);
    throw error;
  }
  return source;
}

/** 同步 git-repo source：clone 目录缺失则 clone，存在则 `pull --ff-only`。无 id 时遍历所有 enabled git-repo。 */
export async function syncSources(configStore: ConfigStore, sourceId?: string, stateStore?: StateStore): Promise<SyncResult[]> {
  const config = await configStore.read();
  const targets: SourceConfig[] = [];
  if (sourceId) {
    const source = requireSource(config, sourceId);
    if (source.type !== "git-repo") throw new Error(`Source ${sourceId} is not a git-repo (got ${source.type})`);
    targets.push(source);
  } else {
    targets.push(...config.sources.filter((source) => source.type === "git-repo" && source.enabled));
  }

  const results: SyncResult[] = [];
  for (const source of targets) {
    const result = await syncOne(source);
    if (result.success && stateStore) {
      const updateResult = await updateInstalledForSource(config, await stateStore.read(), source, stateStore);
      result.updatedSkills = updateResult.updated;
      result.skippedSkills = updateResult.skipped;
      result.conflicts = updateResult.conflicts;
    }
    results.push(result);
  }
  return results;
}

/** 从 config 删除 source；`--purge` 时仅当 path 位于 `repos/` 下才删除已 clone 目录。 */
export async function removeSource(configStore: ConfigStore, id: string, options: { purge?: boolean } = {}): Promise<void> {
  const config = await configStore.read();
  const source = requireSource(config, id);

  if (options.purge) {
    const reposDir = resolveConfiguredPath(config.paths.repos);
    const target = resolveConfiguredPath(source.path);
    const rel = path.relative(reposDir, target);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`--purge refused: source path is not under repos dir: ${target}`);
    }
    await fs.rm(target, { recursive: true, force: true });
  }

  config.sources = config.sources.filter((entry) => entry.id !== id);
  await configStore.write(config);
}

/** 切换 source enabled；未知 id 报错。 */
export async function setSourceEnabled(configStore: ConfigStore, id: string, enabled: boolean): Promise<void> {
  const config = await configStore.read();
  const source = requireSource(config, id);
  source.enabled = enabled;
  await configStore.write(config);
}

function resolveId(config: AppConfig, custom: string | undefined, fallback: string): string {
  const id = custom ?? dedupeId(config, fallback);
  if (config.sources.some((source) => source.id === id)) {
    throw new Error(`Source id already exists: ${id}`);
  }
  return id;
}

function requireSource(config: AppConfig, id: string): SourceConfig {
  const source = config.sources.find((entry) => entry.id === id);
  if (!source) throw new Error(`Unknown source id: ${id}`);
  return source;
}

async function syncOne(source: SourceConfig): Promise<SyncResult> {
  const dest = resolveConfiguredPath(source.path);
  if (!(await pathExists(dest))) {
    if (!source.url) return { sourceId: source.id, action: "clone", success: false, error: "source has no url" };
    try {
      await ensureDir(path.dirname(dest));
      await gitClone(source.url, dest, { branch: source.branch });
      return { sourceId: source.id, action: "clone", success: true };
    } catch (error) {
      await safeCleanup(dest);
      return { sourceId: source.id, action: "clone", success: false, error: errorMessage(error) };
    }
  }
  try {
    const result = await gitPullFfOnly(dest);
    return { sourceId: source.id, action: "pull", success: result.fastForward, error: result.error };
  } catch (error) {
    return { sourceId: source.id, action: "pull", success: false, error: errorMessage(error) };
  }
}

async function updateInstalledForSource(config: AppConfig, state: StateFile, source: SourceConfig, stateStore: StateStore): Promise<{ updated: string[]; skipped: string[]; conflicts: string[] }> {
  const updated: string[] = [];
  const skipped: string[] = [];
  const conflicts: string[] = [];
  for (const record of Object.values(state.installedSkills)) {
    if (record.source.kind !== "configured-source" || record.source.sourceId !== source.id) continue;
    try {
      assertSafeSkillName(record.skillName);
      assertPathInside(getSsotRoot(config), record.ssotPath, "installed SSOT path");
      const sourceRoot = resolveConfiguredPath(source.path);
      const relative = record.source.relativePath === "." ? "" : record.source.relativePath;
      const sourceSkillDir = path.join(sourceRoot, relative);
      assertPathInside(sourceRoot, sourceSkillDir, "source skill path");
      if (!(await pathExists(path.join(sourceSkillDir, "SKILL.md")))) {
        skipped.push(`${record.skillName}: source skill missing`);
        continue;
      }

      const nextHash = await sha256Directory(sourceSkillDir);
      if (nextHash === record.contentHash) {
        skipped.push(`${record.skillName}: up-to-date`);
      } else {
        await copySkillDirToSsot(sourceSkillDir, record.ssotPath, { replace: true });
        const metadata = await readSkillMetadata(record.ssotPath, record.skillName);
        record.displayName = metadata.displayName;
        record.description = metadata.description;
        record.tags = metadata.tags;
        record.contentHash = await sha256Directory(record.ssotPath);
        record.updatedAt = new Date().toISOString();
        updated.push(record.skillName);
        await stateStore.write(state);
      }

      for (const agentRecord of Object.values(record.enabledAgents)) {
        const agent = config.agents[agentRecord.agentId];
        if (!agent) {
          conflicts.push(`${record.skillName}:${agentRecord.agentId}: unknown agent`);
          continue;
        }
        const expectedTargetPath = safeJoin(resolveConfiguredPath(agent.skills_dir), record.skillName, "agent skill path");
        if (path.resolve(agentRecord.targetPath) !== path.resolve(expectedTargetPath)) {
          conflicts.push(`${record.skillName}:${agentRecord.agentId}: state target path does not match agent skill path`);
          continue;
        }
        const result = await ensureSymlinkToSsot(expectedTargetPath, record.ssotPath);
        if (result.status === "conflict") conflicts.push(`${record.skillName}:${agentRecord.agentId}: ${result.reason}`);
      }
    } catch (error) {
      conflicts.push(`${record.skillName}: ${errorMessage(error)}`);
    }
  }

  return { updated, skipped, conflicts };
}

async function safeCleanup(target: string): Promise<void> {
  try {
    await removeRecursive(target);
  } catch {
    // best-effort：回滚清理半成品目录，失败不阻塞主错误。
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
