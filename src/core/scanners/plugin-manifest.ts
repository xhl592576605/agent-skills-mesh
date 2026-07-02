import fs from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";

/**
 * Plugin manifest 读取：对齐 skills.sh（vercel-labs/skills）的 getPluginSkillPaths。
 *
 * 从 <root>/.claude-plugin/{marketplace.json,plugin.json} 提取 skill 搜索目录，
 * 供上层扫描器在 priority 阶段统一发现 SKILL.md。只处理本地路径，远程 source
 * （`{ source, repo }` 对象）跳过。skill/source/pluginRoot 路径须以 `./` 开头
 * （Claude Code 约定），并用 isContainedIn 防止 `..` / 绝对路径逃逸。
 */

interface PluginManifestEntry {
  source?: string | { source: string; repo?: string };
  skills?: string[];
  name?: string;
}

interface MarketplaceManifest {
  metadata?: { pluginRoot?: string };
  plugins?: PluginManifestEntry[];
}

interface PluginManifest {
  skills?: string[];
  name?: string;
}

/** resolved target 必须位于 basePath 之内（防路径穿越）。 */
function isContainedIn(targetPath: string, basePath: string): boolean {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(targetPath));
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(normalizedBase + sep);
}

/** Claude Code 约定：相对路径须以 `./` 开头。 */
function isValidRelativePath(p: string): boolean {
  return p.startsWith("./");
}

/** 读 JSON；文件缺失或非法 JSON 属预期缺席，静默返回 undefined。 */
async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

/**
 * 返回“包含 skill 的目录”列表（绝对路径，已去重）。每个声明 skill 的父目录，
 * 以及每个插件基目录下约定的 `skills/` 目录都会被纳入，交由上层 priority 遍历
 * 在其内查找 SKILL.md（与 skills.sh 一致）。
 */
export async function getPluginSkillPaths(basePath: string): Promise<string[]> {
  const searchDirs: string[] = [];
  const seen = new Set<string>();

  const push = (dir: string): void => {
    if (!isContainedIn(dir, basePath)) return;
    const resolved = resolve(dir);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    searchDirs.push(resolved);
  };

  const addPluginSkillPaths = (pluginBase: string, skills?: string[]): void => {
    if (!isContainedIn(pluginBase, basePath)) return;
    if (skills && skills.length > 0) {
      for (const skillPath of skills) {
        if (!isValidRelativePath(skillPath)) continue;
        push(dirname(join(pluginBase, skillPath)));
      }
    }
    // 约定的 skills/ 目录也纳入发现（dedup 由上层 candidate path 去重 + 本处 seen 保证）。
    push(join(pluginBase, "skills"));
  };

  // 1) marketplace.json（多插件市场）
  const marketplace = await readJson<MarketplaceManifest>(join(basePath, ".claude-plugin", "marketplace.json"));
  if (marketplace) {
    const pluginRoot = marketplace.metadata?.pluginRoot;
    const validPluginRoot = pluginRoot === undefined || isValidRelativePath(pluginRoot);
    if (validPluginRoot) {
      for (const plugin of marketplace.plugins ?? []) {
        // 远程 source（对象形式）跳过，只处理本地 string source。
        if (typeof plugin.source !== "string" && plugin.source !== undefined) continue;
        if (plugin.source !== undefined && !isValidRelativePath(plugin.source)) continue;
        const pluginBase = join(basePath, pluginRoot ?? "", plugin.source ?? "");
        addPluginSkillPaths(pluginBase, plugin.skills);
      }
    }
  }

  // 2) plugin.json（根级单插件）
  const plugin = await readJson<PluginManifest>(join(basePath, ".claude-plugin", "plugin.json"));
  if (plugin) {
    addPluginSkillPaths(basePath, plugin.skills);
  }

  return searchDirs;
}
