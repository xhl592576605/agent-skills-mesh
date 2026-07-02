import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { SourceConfig } from "../models/config.js";
import type { SkillCandidate, SkillOrigin } from "../models/skill.js";
import { sha256File } from "../../utils/hash.js";
import { pathExists } from "../../utils/fs.js";
import { resolveConfiguredPath, toPosixId } from "../../utils/path.js";

export async function scanSource(source: SourceConfig): Promise<SkillCandidate[]> {
  const root = resolveConfiguredPath(source.path);
  if (!(await pathExists(root))) return [];
  const skillDirs = await findSkillDirs(root);
  const origin = sourceOrigin(source);
  return Promise.all(skillDirs.map((dir) => buildCandidate(source, dir, origin)));
}

async function findSkillDirs(root: string): Promise<string[]> {
  if (await pathExists(path.join(root, "SKILL.md"))) return [root];
  const dirs = new Set<string>();
  await addChildSkillDirs(root, dirs);
  const skillsRoot = path.join(root, "skills");
  if (await pathExists(skillsRoot)) await addChildSkillDirs(skillsRoot, dirs);
  return [...dirs].sort();
}

async function addChildSkillDirs(root: string, dirs: Set<string>): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(root, entry.name);
    if (await pathExists(path.join(skillDir, "SKILL.md"))) dirs.add(skillDir);
  }
}

async function buildCandidate(source: SourceConfig, skillDir: string, origin: SkillOrigin): Promise<SkillCandidate> {
  const skillFile = path.join(skillDir, "SKILL.md");
  const [content, stat, hash] = await Promise.all([fs.readFile(skillFile, "utf8"), fs.stat(skillFile), sha256File(skillFile)]);
  const parsed = matter(content);
  const frontmatter = parsed.data as Record<string, unknown>;
  const frontmatterName = typeof frontmatter.name === "string" && frontmatter.name.trim() ? frontmatter.name.trim() : undefined;
  const skillName = frontmatterName ?? path.basename(skillDir);
  const description = typeof frontmatter.description === "string" ? frontmatter.description : undefined;
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.filter((tag): tag is string => typeof tag === "string") : [];
  return {
    id: `${source.id}:${toPosixId(skillName)}:${hash.slice(0, 12)}`,
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
