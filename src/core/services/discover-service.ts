import type { IndexFile } from "../models/index.js";

export type DiscoverKind = "discovered" | "external" | "broken-link" | "conflict";

export interface DiscoverEntry {
  kind: DiscoverKind;
  skillName: string;
  detail: string;
}

/**
 * 从 index 投影出 discover 条目：source 发现的 discovered/conflict skill，以及 agent 目录
 * 中的 external/broken-link installation。供 doctor 报告使用（原顶层 discover 命令已并入 doctor）。
 */
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
    if (installation.status !== "external" && installation.status !== "broken-link") continue;
    entries.push({
      kind: installation.status,
      skillName: installation.skillName,
      detail: formatInstallationDetail(installation.agentId, installation.targetPath, installation.linkTarget, installation.reason)
    });
  }

  return entries;
}

function formatInstallationDetail(agentId: string, targetPath: string, linkTarget?: string, reason?: string): string {
  const target = linkTarget ? `${targetPath} -> ${linkTarget}` : targetPath;
  return `${agentId}: ${target}${reason ? ` (${reason})` : ""}`;
}
