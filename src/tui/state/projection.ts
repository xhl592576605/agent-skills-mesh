import type { AgentConfig } from "../../core/models/config.js"
import type { InstallationRecord } from "../../core/models/installation.js"
import type { Theme } from "../theme/index.js"

/**
 * Matrix 投影纯函数（design §6）。
 *
 * 把 core 的 `config.agents` / `index.installations` 投影为 Matrix 列与单元格标签。
 * 不持状态、不触发 FS，仅做读取映射，便于渲染与测试。
 */

/** 用户 pending 意图（写盘前只存在于 MatrixState.pending）。 */
export type Intent = "install" | "uninstall"

/** Matrix 列：一个 agent 对应一列。 */
export interface AgentColumn {
  id: string
  name: string
  enabled: boolean
}

/**
 * 从 `config.agents` 投影为有序列数组。
 *
 * 保持 config 声明顺序（列稳定，cursor 移动可预测）。disabled agent 也保留为列，
 * 单元格显示 `—`，让用户看到哪些 agent 被禁用（design §6）。
 */
export function buildAgentColumns(agents: Record<string, AgentConfig>): AgentColumn[] {
  return Object.entries(agents).map(([id, agent]) => ({
    id,
    name: agent.name || id,
    enabled: agent.enabled
  }))
}

/**
 * 单元格的「基础」状态（不含 pending 覆盖）。
 *
 * 安装状态映射（design §6 标签表）：
 * - installed → on（`[on]`）
 * - missing / 无 installation → off（`[off]`，toggle 可建立/重建 symlink）
 * - broken-link / conflict / external → warning（`[!]`）
 * - agent 禁用 → disabled（`—`）
 */
export type BaseCellKind = "disabled" | "on" | "off" | "warning"

export function baseCellKind(
  installation: InstallationRecord | undefined,
  agentEnabled: boolean
): BaseCellKind {
  if (!agentEnabled) return "disabled"
  if (!installation) return "off"
  switch (installation.status) {
    case "installed":
      return "on"
    case "missing":
      return "off"
    case "broken-link":
    case "conflict":
    case "external":
      return "warning"
    default:
      return "warning"
  }
}

/** 单元格最终显示类型（含 pending 覆盖原始状态）。 */
export type CellKind = BaseCellKind | "pendingInstall" | "pendingUninstall"

export interface CellInfo {
  kind: CellKind
  /** 文字标签（不依赖颜色，AC7 可访问性冗余）。 */
  label: string
}

const BASE_LABEL: Record<BaseCellKind, string> = {
  disabled: "—",
  on: "[on]",
  off: "[off]",
  warning: "[!]"
}

/**
 * 计算单元格显示信息。pending 意图覆盖原始状态：
 * - pending install → `[+]`（无论原始 on/off/warning）
 * - pending uninstall → `[-]`
 */
export function cellInfo(
  installation: InstallationRecord | undefined,
  agentEnabled: boolean,
  pendingIntent: Intent | undefined
): CellInfo {
  if (pendingIntent === "install") return { kind: "pendingInstall", label: "[+]" }
  if (pendingIntent === "uninstall") return { kind: "pendingUninstall", label: "[-]" }
  const base = baseCellKind(installation, agentEnabled)
  return { kind: base, label: BASE_LABEL[base] }
}

/** 单元格标签颜色（仅辅助，信息已由文字标签传递）。 */
export function cellColor(kind: CellKind, theme: Theme) {
  switch (kind) {
    case "on":
      return theme.success
    case "off":
    case "disabled":
      return theme.textMuted
    case "warning":
      return theme.warning
    case "pendingInstall":
      return theme.primary
    case "pendingUninstall":
      return theme.warning
  }
}

/** installations map 的 key（`${skillName}:${agentId}`，与 install-service detect 一致）。 */
export function installationKey(skillName: string, agentId: string): string {
  return `${skillName}:${agentId}`
}
