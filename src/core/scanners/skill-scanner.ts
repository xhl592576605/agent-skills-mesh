import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { SourceConfig } from "../models/config.js";
import type { SkillCandidate, SkillOrigin } from "../models/skill.js";
import { sha256File } from "../../utils/hash.js";
import { pathExists } from "../../utils/fs.js";
import { resolveConfiguredPath, toPosixId } from "../../utils/path.js";
import { getPluginSkillPaths } from "./plugin-manifest.js";
import { assertSafeSkillName } from "../../utils/safe-path.js";

/** 扫描时跳过的目录名（对齐 skills.sh）。 */
const SKIP_DIRS = ["node_modules", ".git", "dist", "build", "__pycache__"];

/** fallback 全树递归最大深度（对齐 skills.sh maxDepth=5）。 */
const MAX_FALLBACK_DEPTH = 5;

export async function scanSource(source: SourceConfig): Promise<SkillCandidate[]> {
  const root = resolveConfiguredPath(source.path);
  if (!(await pathExists(root))) return [];
  const origin = sourceOrigin(source);

  // agent-dir / global-dir 是扁平安装目录，保持 depth-1（对齐 skills.sh 对 agent 前缀的处理）。
  const dirs = source.type === "agent-dir" || source.type === "global-dir" ? await flatScan(root) : await discoverSkillDirs(root);

  // path 去重：同 source 内 priority + fallback 可能命中同一目录。
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push(dir);
  }

  return Promise.all(unique.map((dir) => buildCandidate(source, dir, origin)));
}

async function hasSkillMd(dir: string): Promise<boolean> {
  return pathExists(path.join(dir, "SKILL.md"));
}

/** root 直接子目录（含 root 本身）含 SKILL.md 即收录，depth-1。用于 agent-dir / global-dir。 */
async function flatScan(root: string): Promise<string[]> {
  const dirs: string[] = [];
  if (await hasSkillMd(root)) dirs.push(root);
  const entries = await readDirEntries(root);
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.includes(entry.name)) continue;
    const child = path.join(root, entry.name);
    if (await hasSkillMd(child)) dirs.push(child);
  }
  return dirs;
}

/**
 * 对齐 skills.sh discoverSkills：priority 目录顺序遍历 + 容器目录 depth-2 +
 * 遇 SKILL.md 不下钻 + SKIP_DIRS + fallback 递归。
 *
 * - root 自身含 SKILL.md → 仅返回 [root]（root 即 skill，对齐 skills.sh 非 fullDepth 早退）。
 * - root 保持 depth-1（防 examples/foo/SKILL.md 噪音）；plugin manifest 路径保持 depth-1
 *   （manifest 已指向 skill 父目录）；其余容器目录（skills/、.curated 等）走 depth-2。
 */
async function discoverSkillDirs(root: string): Promise<string[]> {
  if (await hasSkillMd(root)) return [root];

  const found: string[] = [];
  const pluginPaths = await getPluginSkillPaths(root);
  const rootResolved = path.resolve(root);

  const priorityDirs = [
    root,
    path.join(root, "skills"),
    path.join(root, "skills", ".curated"),
    path.join(root, "skills", ".experimental"),
    path.join(root, "skills", ".system"),
    ...pluginPaths,
  ];
  // depth-1 集合：root 与 plugin manifest 路径。其余为容器目录（walkDeep）。
  const depth1Set = new Set<string>([rootResolved, ...pluginPaths.map((p) => path.resolve(p))]);
  const isContainer = (dir: string): boolean => !depth1Set.has(path.resolve(dir));

  for (const dir of priorityDirs) {
    const walkDeep = isContainer(dir);
    const entries = await readDirEntries(dir);
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.includes(entry.name)) continue;
      const childDir = path.join(dir, entry.name);
      if (await hasSkillMd(childDir)) {
        found.push(childDir);
        continue; // 遇 SKILL.md 不下钻
      }
      if (!walkDeep) continue;
      // 容器目录：再下钻一层（depth-2），孙目录有 SKILL.md 即收录，不再继续。
      const grandEntries = await readDirEntries(childDir);
      for (const grand of grandEntries) {
        if (!grand.isDirectory() || SKIP_DIRS.includes(grand.name)) continue;
        const grandDir = path.join(childDir, grand.name);
        if (await hasSkillMd(grandDir)) found.push(grandDir);
      }
    }
  }

  // fallback：priority 全空时全树递归。
  if (found.length === 0) {
    found.push(...(await findSkillDirsRecursive(root, 0)));
  }

  return found;
}

/** fallback 递归：遇 SKILL.md 收录且不再下钻，SKIP_DIRS 过滤，maxDepth=5。 */
async function findSkillDirsRecursive(dir: string, depth: number): Promise<string[]> {
  if (depth > MAX_FALLBACK_DEPTH) return [];
  if (await hasSkillMd(dir)) return [dir];
  const entries = await readDirEntries(dir);
  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.includes(entry.name)) continue;
    dirs.push(...(await findSkillDirsRecursive(path.join(dir, entry.name), depth + 1)));
  }
  return dirs;
}

async function readDirEntries(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function buildCandidate(source: SourceConfig, skillDir: string, origin: SkillOrigin): Promise<SkillCandidate> {
  const root = resolveConfiguredPath(source.path);
  const skillFile = path.join(skillDir, "SKILL.md");
  const [content, stat, hash] = await Promise.all([fs.readFile(skillFile, "utf8"), fs.stat(skillDir), sha256File(skillFile)]);
  const parsed = matter(content);
  const frontmatter = parsed.data as Record<string, unknown>;
  const frontmatterName = typeof frontmatter.name === "string" && frontmatter.name.trim() ? frontmatter.name.trim() : undefined;
  const skillName = frontmatterName ?? path.basename(skillDir);
  assertSafeSkillName(skillName);
  const description = typeof frontmatter.description === "string" ? frontmatter.description : undefined;
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.filter((tag): tag is string => typeof tag === "string") : [];
  const relative = path.relative(root, skillDir).split(path.sep).join("/") || ".";
  return {
    id: `${source.id}:${toPosixId(skillName)}:${toPosixId(relative)}`,
    skillName,
    sourceId: source.id,
    sourceType: source.type,
    path: skillDir,
    entry: "SKILL.md",
    description,
    frontmatter,
    tags,
    hash,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    origin,
    managed: origin === "configured-source"
  };
}

function sourceOrigin(source: SourceConfig): SkillOrigin {
  if (source.type === "global-dir") return "global-dir";
  if (source.type === "agent-dir") return "agent-dir";
  return "configured-source";
}
