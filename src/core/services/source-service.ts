import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig, SourceConfig } from "../models/config.js";
import { ConfigStore } from "../storage/config-store.js";
import type { StateStore } from "../storage/state-store.js";
import type { InstalledSkillRecord, StateFile } from "../models/state.js";
import type { SkillCandidate } from "../models/skill.js";
import { scanSource } from "../scanners/skill-scanner.js";
import { ensureDir, pathExists, removeRecursive } from "../../utils/fs.js";
import { resolveConfiguredPath, toPosixId } from "../../utils/path.js";
import { gitClone, gitPullFfOnly } from "../../utils/git.js";
import { sha256Directory } from "../../utils/hash.js";
import { assertPathInside } from "../../utils/safe-path.js";
import { detachAgentSymlinks, getSsotRoot } from "./ssot-service.js";
import { bizError } from "../errors.js";


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

export type AddSourceType = "repo" | "folder" | "skill";

export interface AddSourceOptions {
  type?: AddSourceType;
  branch?: string;
  id?: string;
}

export interface AddSourceResult {
  source: SourceConfig;
  /** 自动探测重新关联的孤儿 skill（state.source.sourceId 被重写为新 source）。 */
  reboundOrphans: string[];
}

/**
 * 统一注册来源（R2 三合一）。`--type` 缺省时自动推断：url→repo，含 SKILL.md 目录→skill，
 * 含子 skill 目录→folder。注册后自动探测 state 中的孤儿 skill 并按逻辑坐标/contentHash 重新关联（R5）。
 */
export async function addSource(configStore: ConfigStore, stateStore: StateStore, target: string, options: AddSourceOptions = {}): Promise<AddSourceResult> {
  const type = options.type ?? (await inferSourceType(target));
  let source: SourceConfig;
  if (type === "repo") source = await addRepoSource(configStore, target, { id: options.id, branch: options.branch });
  else if (type === "skill") source = await addSingleSkillSource(configStore, target, { id: options.id });
  else source = await addLocalDirSource(configStore, target, { id: options.id });
  const reboundOrphans = await rebindOrphansForNewSource(configStore, stateStore, source);
  return { source, reboundOrphans };
}

/** 注册本地多 skill 目录为 `local-dir` source；重复 path 报错。 */
async function addLocalDirSource(configStore: ConfigStore, dirPath: string, options: { id?: string } = {}): Promise<SourceConfig> {
  const resolved = resolveConfiguredPath(dirPath);
  if (!(await pathExists(resolved))) throw bizError("SOURCE_PATH_NOT_EXIST", { path: resolved }, `Source path does not exist: ${resolved}`);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) throw bizError("SOURCE_PATH_NOT_DIRECTORY", { path: resolved }, `Source path is not a directory: ${resolved}`);

  const config = await configStore.read();
  const duplicate = config.sources.find((source) => resolveConfiguredPath(source.path) === resolved);
  if (duplicate) throw bizError("SOURCE_ALREADY_REGISTERED", { id: duplicate.id, path: duplicate.path }, `Source already registered: id=${duplicate.id} path=${duplicate.path}`);

  const id = resolveId(config, options.id, slugify(dirPath));
  const source: SourceConfig = { id, name: path.basename(resolved), type: "local-dir", path: resolved, enabled: true, readonly: false };
  config.sources.push(source);
  await configStore.write(config);
  return source;
}

/** 注册单个 skill 目录为 `single-skill` source；校验 `dirPath/SKILL.md` 存在。 */
async function addSingleSkillSource(configStore: ConfigStore, dirPath: string, options: { id?: string } = {}): Promise<SourceConfig> {
  const resolved = resolveConfiguredPath(dirPath);
  if (!(await pathExists(path.join(resolved, "SKILL.md")))) {
    throw bizError("SOURCE_NOT_SKILL_DIR", { path: resolved }, `Not a skill directory (missing SKILL.md): ${resolved}`);
  }
  const config = await configStore.read();
  const duplicate = config.sources.find((source) => resolveConfiguredPath(source.path) === resolved);
  if (duplicate) throw bizError("SOURCE_ALREADY_REGISTERED", { id: duplicate.id, path: duplicate.path }, `Source already registered: id=${duplicate.id} path=${duplicate.path}`);

  const id = resolveId(config, options.id, slugify(dirPath));
  const source: SourceConfig = { id, name: path.basename(resolved), type: "single-skill", path: resolved, enabled: true, readonly: false };
  config.sources.push(source);
  await configStore.write(config);
  return source;
}

/** 推断来源类型：url→repo，目录含 SKILL.md→skill，含子 skill 目录→folder，否则 folder。 */
async function inferSourceType(target: string): Promise<AddSourceType> {
  if (isUrl(target)) return "repo";
  const resolved = resolveConfiguredPath(target);
  if (!(await pathExists(resolved))) throw bizError("SOURCE_PATH_NOT_EXIST", { path: resolved }, `Source path does not exist: ${resolved}`);
  if (await pathExists(path.join(resolved, "SKILL.md"))) return "skill";
  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && (await pathExists(path.join(resolved, entry.name, "SKILL.md")))) return "folder";
    }
  } catch {
    // 无目录访问权限等：默认 folder。
  }
  return "folder";
}

/** 判断 target 是否为远程 url（http/https/git/ssh 协议，或 scp 语法 host:path）。 */
function isUrl(target: string): boolean {
  if (/^(https?|git|ssh|ftp):\/\//.test(target)) return true;
  if (/^[A-Za-z]:[\\/]/.test(target)) return false; // Windows 绝对路径（C:\…）
  // scp 语法：[user@]host:path（冒号前无 /）。
  return /^[^/@\s]+@[^/\s:@]+:[^/\s]/.test(target) || /^[A-Za-z0-9][\w.-]*:[^/\s]/.test(target);
}

/** clone git 仓库到 `repos/<id>`，成功后注册 `git-repo` source；clone 失败不写 config 并清理半成品。 */
export async function addRepoSource(configStore: ConfigStore, gitUrl: string, options: { id?: string; branch?: string } = {}): Promise<SourceConfig> {
  const config = await configStore.read();
  const dup = config.sources.find((source) => source.type === "git-repo" && source.url === gitUrl);
  if (dup) throw bizError("GIT_REPO_ALREADY_REGISTERED", { id: dup.id, url: gitUrl }, `Git repo already registered: id=${dup.id} url=${gitUrl}`);

  const id = resolveId(config, options.id, slugify(gitUrl));
  const reposDir = resolveConfiguredPath(config.paths.repos);
  const dest = path.join(reposDir, id);
  if (await pathExists(dest)) throw bizError("REPO_TARGET_EXISTS", { dest }, `Repo target already exists: ${dest}`);

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

export interface SourceUpdateReport {
  sourceId: string;
  action: "clone" | "pull" | "rescan";
  success: boolean;
  error?: string;
  /** source 目录 hash 与 state.contentHash 不同：有新版，待 `skill update`。 */
  updatableSkills: string[];
  /** hash 一致，无新版。 */
  upToDateSkills: string[];
}

/**
 * 拉取/重扫来源（git `pull --ff-only` / folder·single-skill 重扫），比较 installed skill 的 source hash
 * 与 state.contentHash，报告哪些有新版。**不**替换 SSOT（R3 两步分离：SSOT 替换由 `skillUpdate` 显式触发）。
 * 无 id 时遍历所有 enabled non-agent-dir source。
 */
export async function sourceUpdate(configStore: ConfigStore, stateStore: StateStore, sourceId?: string): Promise<SourceUpdateReport[]> {
  const config = await configStore.read();
  const state = await stateStore.read();
  const targets: SourceConfig[] = sourceId
    ? [requireSource(config, sourceId)]
    : config.sources.filter((source) => source.enabled && source.type !== "agent-dir");
  const reports: SourceUpdateReport[] = [];
  for (const source of targets) {
    reports.push(await updateOneSource(config, state, source));
  }
  return reports;
}

async function updateOneSource(config: AppConfig, state: StateFile, source: SourceConfig): Promise<SourceUpdateReport> {
  const dest = resolveConfiguredPath(source.path);
  const exists = await pathExists(dest);
  const action: SourceUpdateReport["action"] = source.type === "git-repo" ? (exists ? "pull" : "clone") : "rescan";

  if (source.type === "git-repo") {
    const pulled = await syncOne(source);
    if (!pulled.success) return { sourceId: source.id, action, success: false, error: pulled.error, updatableSkills: [], upToDateSkills: [] };
  } else if (!exists) {
    return { sourceId: source.id, action, success: false, error: `Source path does not exist: ${dest}`, updatableSkills: [], upToDateSkills: [] };
  }

  const updatable: string[] = [];
  const upToDate: string[] = [];
  for (const record of Object.values(state.installedSkills)) {
    if (record.source.kind !== "configured-source" || record.source.sourceId !== source.id) continue;
    const sourceSkillDir = resolveSourceSkillDir(source, record.source.relativePath);
    if (!(await pathExists(path.join(sourceSkillDir, "SKILL.md")))) continue;
    const nextHash = await sha256Directory(sourceSkillDir);
    if (nextHash === record.contentHash) upToDate.push(record.skillName);
    else updatable.push(record.skillName);
  }
  return { sourceId: source.id, action, success: true, updatableSkills: updatable, upToDateSkills: upToDate };
}

/** source root + relativePath → source 中该 skill 的目录绝对路径（供 sourceUpdate/skillUpdate 复用）。含 containment 校验，防 `../` 逃逸。 */
export function resolveSourceSkillDir(source: SourceConfig, relativePath: string): string {
  const sourceRoot = resolveConfiguredPath(source.path);
  const relative = relativePath === "." ? "" : relativePath;
  const resolved = path.join(sourceRoot, relative);
  assertPathInside(sourceRoot, resolved, "source skill path");
  return resolved;
}

/**
 * 从 config 删除 source（R4）。
 * - 默认：只删 config.sources 记录，保留其贡献的 SSOT skill 与 agent symlink（变为孤儿，
 *   由 refresh 实时计算 orphan 标记；仍可 enable/disable，但 skill update 失败）。
 * - `--purge`：级联删除该 source 贡献的 SSOT 目录 + 断开所有 agent symlink + 删 state record；
 *   git-repo 的 clone 目录（位于 repos/ 下）一并删除。
 */
export async function removeSource(configStore: ConfigStore, stateStore: StateStore, id: string, options: { purge?: boolean } = {}): Promise<{ orphaned: string[]; purged: string[] }> {
  const config = await configStore.read();
  const source = requireSource(config, id);
  const state = await stateStore.read();
  const contributed = Object.values(state.installedSkills).filter((record) => record.source.kind === "configured-source" && record.source.sourceId === id);

  if (options.purge) {
    // 先校验所有 SSOT 路径在 SSOT root 内（防 state 污染导致误删任意目录）。
    for (const record of contributed) {
      assertPathInside(getSsotRoot(config), record.ssotPath, "installed SSOT path");
    }
    // 删 symlink（仅删经校验的、指向 agent.skills_dir/<skillName> 的 symlink）+ 删 SSOT。
    // SSOT 删除失败抛错（关键操作），此时 state/config 尚未写回，保持一致。
    for (const record of contributed) {
      await detachAgentSymlinks(config, record);
      await fs.rm(record.ssotPath, { recursive: true, force: true });
      delete state.installedSkills[record.skillName];
    }
    await stateStore.write(state);
    // git-repo clone 目录删除（仅 git-repo；越界抛错，不静默跳过）。
    if (source.type === "git-repo") {
      const reposDir = resolveConfiguredPath(config.paths.repos);
      const cloneTarget = resolveConfiguredPath(source.path);
      const rel = path.relative(reposDir, cloneTarget);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw bizError("PURGE_REFUSED_NOT_UNDER_REPOS", { path: cloneTarget }, `--purge refused: git repo path is not under repos dir: ${cloneTarget}`);
      }
      await safeRmRf(cloneTarget);
    }
  }

  config.sources = config.sources.filter((entry) => entry.id !== id);
  await configStore.write(config);
  return {
    orphaned: options.purge ? [] : contributed.map((record) => record.skillName),
    purged: options.purge ? contributed.map((record) => record.skillName) : []
  };
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
    throw bizError("SOURCE_ID_EXISTS", { id }, `Source id already exists: ${id}`);
  }
  return id;
}

function requireSource(config: AppConfig, id: string): SourceConfig {
  const source = config.sources.find((entry) => entry.id === id);
  if (!source) throw bizError("SOURCE_ID_UNKNOWN", { id }, `Unknown source id: ${id}`);
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

/**
 * 新 source 注册后，自动探测 state 中的孤儿 skill 并重新关联（R5）。
 * - git source：按 url 匹配（branch 随新 source）。
 * - 非 git source：按 contentHash（source skill 目录 hash === state.contentHash）匹配。
 * 匹配到的孤儿重写 sourceId 与逻辑坐标，恢复 update 能力。
 */
async function rebindOrphansForNewSource(configStore: ConfigStore, stateStore: StateStore, source: SourceConfig): Promise<string[]> {
  const config = await configStore.read();
  const state = await stateStore.read();
  const candidates = await scanSource(source);
  const candidateByName = new Map<string, SkillCandidate>();
  const ambiguousNames = new Set<string>();
  for (const candidate of candidates) {
    if (candidateByName.has(candidate.skillName)) ambiguousNames.add(candidate.skillName);
    else candidateByName.set(candidate.skillName, candidate);
  }

  const sourceRoot = resolveConfiguredPath(source.path);
  const rebound: string[] = [];
  let changed = false;
  for (const record of Object.values(state.installedSkills)) {
    if (record.source.kind !== "configured-source") continue;
    const installedSource = record.source;
    if (config.sources.some((entry) => entry.id === installedSource.sourceId)) continue; // 非孤儿
    const candidate = candidateByName.get(record.skillName);
    if (!candidate || ambiguousNames.has(record.skillName)) continue; // 同名多 candidate 歧义：交由显式 `skill rebind`。
    if (!(await matchOrphanToCandidate(installedSource, record.contentHash, source, candidate))) continue;
    installedSource.sourceId = source.id;
    installedSource.sourceType = source.type;
    installedSource.sourcePath = sourceRoot;
    installedSource.relativePath = path.relative(sourceRoot, candidate.path).split(path.sep).join("/") || ".";
    if (source.url !== undefined) installedSource.url = source.url;
    if (source.branch !== undefined) installedSource.branch = source.branch;
    rebound.push(record.skillName);
    changed = true;
  }
  if (changed) await stateStore.write(state);
  return rebound;
}

async function matchOrphanToCandidate(installedSource: { url?: string; branch?: string }, contentHash: string, source: SourceConfig, candidate: SkillCandidate): Promise<boolean> {
  if (source.type === "git-repo") {
    const urlMatch = installedSource.url && source.url && installedSource.url === source.url;
    const branchMatch = installedSource.branch === source.branch;
    return Boolean(urlMatch && branchMatch);
  }
  // 非 git：source skill 目录 hash === state contentHash（注意 candidate.hash 是文件 hash，不可直接比）。
  const sourceDirHash = await sha256Directory(candidate.path);
  return sourceDirHash === contentHash;
}

/** best-effort 递归删除目录。 */
async function safeRmRf(targetPath: string): Promise<void> {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch {
    // best-effort：删除失败不阻塞 source remove 主流程。
  }
}
