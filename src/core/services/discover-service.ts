import fs from "node:fs/promises";
import path from "node:path";
import { ConfigStore } from "../storage/config-store.js";
import type { IndexStore } from "../storage/index-store.js";
import type { IndexFile } from "../models/index.js";
import { ensureDir, pathExists } from "../../utils/fs.js";
import { resolveConfiguredPath } from "../../utils/path.js";
import { refreshIndex } from "./refresh-service.js";

export type DiscoverKind = "discovered" | "external" | "broken-link" | "conflict";

export interface DiscoverEntry {
  kind: DiscoverKind;
  skillName: string;
  detail: string;
}

export interface AdoptResult {
  skillName: string;
  sourcePath: string;
  targetPath: string;
}

export function listDiscover(index: IndexFile): DiscoverEntry[] {
  const entries: DiscoverEntry[] = [];

  for (const skill of Object.values(index.skills).sort((a, b) => a.name.localeCompare(b.name))) {
    if (skill.status === "discovered") {
      entries.push({ kind: "discovered", skillName: skill.name, detail: skill.candidates.map((candidate) => candidate.path).join(", ") });
    } else if (skill.status === "conflict") {
      entries.push({ kind: "conflict", skillName: skill.name, detail: `${skill.candidates.length} candidates: ${skill.candidates.map((candidate) => candidate.path).join(", ")}` });
    }
  }

  for (const installation of Object.values(index.installations).sort((a, b) => a.id.localeCompare(b.id))) {
    const skill = index.skills[installation.skillName];
    if (skill?.status === "ignored" || skill?.ignored) continue;
    if (installation.status !== "external" && installation.status !== "broken-link") continue;
    entries.push({
      kind: installation.status,
      skillName: installation.skillName,
      detail: formatInstallationDetail(installation.agentId, installation.targetPath, installation.linkTarget, installation.reason)
    });
  }

  return entries;
}

export async function adoptSkill(configStore: ConfigStore, indexStore: IndexStore, skillName: string): Promise<AdoptResult> {
  const config = await configStore.read();
  const originalConfig = structuredClone(config);
  const index = await indexStore.read();
  const skill = index.skills[skillName];
  if (!skill) throw new Error(`Skill not found: ${skillName}`);
  if (skill.status !== "discovered") throw new Error(`Skill ${skillName} is not discovered (status=${skill.status})`);
  if (skill.candidates.length !== 1) throw new Error(`Adopt requires exactly one discovered candidate for ${skillName}; found ${skill.candidates.length}`);

  const candidate = skill.candidates[0];
  const sourcePath = resolveConfiguredPath(candidate.path);
  const sourceStat = await safeLstat(sourcePath);
  if (!sourceStat) throw new Error(`Discovered skill path does not exist: ${sourcePath}`);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error(`Discovered skill path must be a real directory: ${sourcePath}`);

  const globalSource = config.sources.find((source) => source.type === "global-dir");
  if (!globalSource) throw new Error("No global-dir source configured for adopt target");
  const globalDir = resolveConfiguredPath(globalSource.path);
  const targetPath = path.join(globalDir, skillName);
  const alreadyInGlobalSource = samePath(sourcePath, targetPath);
  if (!alreadyInGlobalSource && (await pathExists(targetPath))) throw new Error(`Adopt target already exists: ${targetPath}`);

  let moved = false;
  let linked = false;
  let configWritten = false;
  try {
    await ensureDir(globalDir);
    if (!alreadyInGlobalSource) {
      await fs.rename(sourcePath, targetPath);
      moved = true;
      await fs.symlink(targetPath, sourcePath, "dir");
      linked = true;
    }

    config.skillOverrides = {
      ...config.skillOverrides,
      [skillName]: { ...config.skillOverrides[skillName], managed: true }
    };
    await configStore.write(config);
    configWritten = true;

    const next = await refreshIndex(config, index);
    await indexStore.write(next);
    return { skillName, sourcePath, targetPath };
  } catch (error) {
    await rollbackAdopt({ sourcePath, targetPath, linked, moved });
    if (configWritten) await restoreConfig(configStore, originalConfig);
    throw error;
  }
}

export async function setIgnored(configStore: ConfigStore, indexStore: IndexStore, skillName: string, ignored: boolean): Promise<void> {
  const config = await configStore.read();
  const index = await indexStore.read();
  if (!index.skills[skillName]) throw new Error(`Skill not found: ${skillName}`);

  const nextOverride = { ...config.skillOverrides[skillName] };
  if (ignored) nextOverride.ignored = true;
  else delete nextOverride.ignored;

  config.skillOverrides = { ...config.skillOverrides };
  if (Object.keys(nextOverride).length > 0) config.skillOverrides[skillName] = nextOverride;
  else delete config.skillOverrides[skillName];

  await configStore.write(config);
  const next = await refreshIndex(config, index);
  await indexStore.write(next);
}

function formatInstallationDetail(agentId: string, targetPath: string, linkTarget?: string, reason?: string): string {
  const target = linkTarget ? `${targetPath} -> ${linkTarget}` : targetPath;
  return `${agentId}: ${target}${reason ? ` (${reason})` : ""}`;
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

async function safeLstat(filePath: string) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function rollbackAdopt(options: { sourcePath: string; targetPath: string; linked: boolean; moved: boolean }): Promise<void> {
  if (options.linked) {
    try {
      const stat = await safeLstat(options.sourcePath);
      if (stat?.isSymbolicLink()) await fs.unlink(options.sourcePath);
    } catch {
      // best-effort rollback: preserve the original error.
    }
  }
  if (options.moved) {
    try {
      const sourceExists = await pathExists(options.sourcePath);
      const targetExists = await pathExists(options.targetPath);
      if (!sourceExists && targetExists) await fs.rename(options.targetPath, options.sourcePath);
    } catch {
      // best-effort rollback: preserve the original error.
    }
  }
}

async function restoreConfig(configStore: ConfigStore, config: Awaited<ReturnType<ConfigStore["read"]>>): Promise<void> {
  try {
    await configStore.write(config);
  } catch {
    // best-effort rollback: preserve the original error.
  }
}
