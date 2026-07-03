import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { AppConfig, SourceConfig } from "../models/config.js";
import type { SkillCandidate } from "../models/skill.js";
import type { InstalledAgentRecord, InstalledSkillRecord, InstalledSkillSource } from "../models/state.js";
import { ensureDir, pathExists, removeRecursive } from "../../utils/fs.js";
import { resolveConfiguredPath } from "../../utils/path.js";
import { sha256Directory } from "../../utils/hash.js";
import { assertPathInside, assertSafeSkillName, safeJoin } from "../../utils/safe-path.js";

export interface SkillMetadataSummary {
  displayName: string;
  description?: string;
  tags: string[];
}

export interface EnsureSymlinkResult {
  status: "created" | "ok" | "conflict";
  reason?: string;
}

export function getSsotRoot(config: AppConfig): string {
  return resolveConfiguredPath(config.paths.skills ?? path.join(config.paths.home, "skills"));
}

export function getSsotSkillPath(config: AppConfig, skillName: string): string {
  return safeJoin(getSsotRoot(config), skillName, "SSOT skill path");
}

export async function readSkillMetadata(skillDir: string, fallbackName = path.basename(skillDir)): Promise<SkillMetadataSummary> {
  const content = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
  const parsed = matter(content);
  const frontmatter = parsed.data as Record<string, unknown>;
  const displayName = typeof frontmatter.name === "string" && frontmatter.name.trim() ? frontmatter.name.trim() : fallbackName;
  assertSafeSkillName(displayName);
  const description = typeof frontmatter.description === "string" ? frontmatter.description : undefined;
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.filter((tag): tag is string => typeof tag === "string") : [];
  return { displayName, description, tags };
}

export async function copySkillDirToSsot(sourceDir: string, ssotPath: string, options: { replace?: boolean } = {}): Promise<string> {
  assertPathInside(path.dirname(ssotPath), ssotPath, "SSOT target path");
  if (!(await pathExists(path.join(sourceDir, "SKILL.md")))) {
    throw new Error(`Source skill is missing SKILL.md: ${sourceDir}`);
  }

  await ensureDir(path.dirname(ssotPath));
  const tempPath = path.join(path.dirname(ssotPath), `.tmp-${path.basename(ssotPath)}-${process.pid}-${Date.now()}`);
  const backupPath = path.join(path.dirname(ssotPath), `.bak-${path.basename(ssotPath)}-${process.pid}-${Date.now()}`);
  let backedUp = false;
  let installed = false;
  try {
    await fs.cp(sourceDir, tempPath, { recursive: true, dereference: false });
    if (!(await pathExists(path.join(tempPath, "SKILL.md")))) {
      throw new Error(`Copied skill is invalid (missing SKILL.md): ${tempPath}`);
    }

    const current = await safeLstat(ssotPath);
    if (current) {
      if (!current.isDirectory() || current.isSymbolicLink()) {
        throw new Error(`SSOT target exists and is not a real directory: ${ssotPath}`);
      }
      if (!options.replace) throw new Error(`SSOT target already exists: ${ssotPath}`);
      await fs.rename(ssotPath, backupPath);
      backedUp = true;
    }

    await fs.rename(tempPath, ssotPath);
    installed = true;
    if (backedUp) await removeRecursive(backupPath);
    return await sha256Directory(ssotPath);
  } catch (error) {
    await removeRecursive(tempPath);
    if (backedUp && !installed) {
      try {
        if (!(await pathExists(ssotPath)) && (await pathExists(backupPath))) await fs.rename(backupPath, ssotPath);
      } catch {
        // best-effort rollback: preserve original error.
      }
    }
    throw error;
  }
}

export async function createInstalledRecordFromCandidate(config: AppConfig, candidate: SkillCandidate, existing?: InstalledSkillRecord): Promise<InstalledSkillRecord> {
  const source = config.sources.find((entry) => entry.id === candidate.sourceId) ?? {
    id: candidate.sourceId,
    name: candidate.sourceId,
    type: candidate.sourceType,
    path: candidate.path,
    enabled: true
  };
  const ssotPath = getSsotSkillPath(config, candidate.skillName);
  const metadata = await readSkillMetadata(ssotPath, candidate.skillName);
  const now = new Date().toISOString();
  return {
    skillName: candidate.skillName,
    displayName: metadata.displayName,
    description: metadata.description,
    tags: metadata.tags,
    ssotPath,
    source: installedSourceFromCandidate(source, candidate),
    contentHash: await sha256Directory(ssotPath),
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
    enabledAgents: existing?.enabledAgents ?? {}
  };
}

export function installedSourceFromCandidate(source: SourceConfig, candidate: SkillCandidate): InstalledSkillSource {
  const sourcePath = resolveConfiguredPath(source.path);
  const candidatePath = resolveConfiguredPath(candidate.path);
  const relative = path.relative(sourcePath, candidatePath);
  return {
    kind: "configured-source",
    sourceId: source.id,
    sourceType: source.type,
    sourcePath,
    relativePath: relative ? relative.split(path.sep).join("/") : ".",
    url: source.url,
    branch: source.branch
  };
}

export function createInstalledAgentRecord(agentId: string, targetPath: string): InstalledAgentRecord {
  return { agentId, targetPath, linkedAt: new Date().toISOString() };
}

export async function ensureSymlinkToSsot(targetPath: string, ssotPath: string): Promise<EnsureSymlinkResult> {
  const stat = await safeLstat(targetPath);
  if (!stat) {
    await ensureDir(path.dirname(targetPath));
    await fs.symlink(ssotPath, targetPath, "dir");
    return { status: "created" };
  }
  if (!stat.isSymbolicLink()) return { status: "conflict", reason: "target exists and is not a symlink" };
  const linkTarget = path.resolve(path.dirname(targetPath), await fs.readlink(targetPath));
  if (samePath(linkTarget, ssotPath)) return { status: "ok" };
  return { status: "conflict", reason: `target symlink points to ${linkTarget}` };
}

export async function replaceSymlinkToSsot(targetPath: string, ssotPath: string): Promise<void> {
  const stat = await safeLstat(targetPath);
  if (stat) {
    if (!stat.isSymbolicLink()) throw new Error(`Target is not a symlink: ${targetPath}`);
    await fs.unlink(targetPath);
  }
  await ensureDir(path.dirname(targetPath));
  await fs.symlink(ssotPath, targetPath, "dir");
}

export async function safeLstat(filePath: string) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}
