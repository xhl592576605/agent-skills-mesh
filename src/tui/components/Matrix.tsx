import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { AgentConfig } from "../../core/models/config.js";
import type { InstallationRecord, InstallationStatus } from "../../core/models/installation.js";
import type { SkillRecord } from "../../core/models/skill.js";
import type { MatrixCursor } from "../state/types.js";
import type { PendingIntent } from "../state/types.js";

/**
 * Matrix 列描述：config.agents 顺序的展示投影。
 *
 * `id` 是 AgentConfig 在 config.agents 中的 key（域模型本身不带 id），其余字段
 * 复用 `AgentConfig`。`enabledOrdinal` 是该 agent 在「仅 enabled」序列中的下标，
 * 用于把 reducer 的 `cursor.col`（基于 enabled 列）对齐到展示列。
 */
export interface MatrixAgentColumn {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly enabledOrdinal: number;
}

/** pending 的外层结构复用 reducer/state 的形状：skillName → agentId → intent。 */
export type PendingMap = ReadonlyMap<string, ReadonlyMap<string, PendingIntent>>;

export interface MatrixProps {
  readonly skills: readonly SkillRecord[];
  readonly agents: readonly MatrixAgentColumn[];
  readonly installations: Record<string, InstallationRecord>;
  readonly pending: PendingMap;
  readonly cursor: MatrixCursor;
}

/** 单元格符号宽度下限（容纳 `[~+]` 与最长 agent id 表头）。 */
const MIN_CELL_WIDTH = 5;

/**
 * 按 design「屏幕设计 Matrix」把 installation status + pending 意图映射为终端符号。
 *
 * 终端安全：pending 用 `~+/~-` 叠加意图箭头；非 pending 按 status 取符号。
 * 不依赖颜色（颜色仅作辅助），符号本身即信息。
 */
export function cellSymbol(status: InstallationStatus | undefined, pending: PendingIntent | undefined): string {
  if (pending === "install") return "~+";
  if (pending === "uninstall") return "~-";
  switch (status) {
    case "installed":
      return "✓";
    case "conflict":
    case "broken-link":
    case "external":
      return "!";
    case "missing":
      return "·";
    default:
      return "○";
  }
}

/**
 * 由 config.agents 构建 Matrix 列（保留声明顺序，含 disabled；计算 enabledOrdinal）。
 * 与 reducer `matrixDimensions` 的「enabled 列」语义一致：disabled 列展示但不可达。
 */
export function buildAgentColumns(agents: Readonly<Record<string, AgentConfig>>): MatrixAgentColumn[] {
  let enabledOrdinal = -1;
  return Object.entries(agents).map(([id, agent]) => {
    if (agent.enabled) enabledOrdinal += 1;
    return { id, name: agent.name, enabled: agent.enabled, enabledOrdinal: agent.enabled ? enabledOrdinal : -1 };
  });
}

/** index.installations 的 key 规约（与 install-service detectInstallation 一致）。 */
function installationKey(skillName: string, agentId: string): string {
  return `${skillName}:${agentId}`;
}

/**
 * 纯展示 Matrix（受控）。只渲染符号 + 光标高亮，不调 service、不持有写状态。
 *
 * 行：skills（调用方已按 name 排序）。列：agents（含 disabled，灰显 ×）。
 * 光标格用 `[sym]` 高亮，基于 `cursor.col` 命中的 enabled 列（与 reducer clamp 一致）。
 */
export function Matrix({ skills, agents, installations, pending, cursor }: MatrixProps): ReactElement {
  const enabledAgents = agents.filter((agent) => agent.enabled);
  const nameWidth = skills.reduce((max, skill) => Math.max(max, skill.name.length), "skill".length);
  const cellWidth = agents.reduce((max, agent) => Math.max(max, agent.id.length + 1), MIN_CELL_WIDTH);

  const formatCell = (token: string, isCursor: boolean): string => {
    const inner = isCursor ? `[${token}]` : ` ${token} `;
    return inner.padEnd(cellWidth);
  };

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{"skill".padEnd(nameWidth)} </Text>
        {agents.map((agent) => (
          <Text key={agent.id} bold dimColor={!agent.enabled}>
            {` ${agent.id}`.padEnd(cellWidth)}
          </Text>
        ))}
      </Text>
      {skills.map((skill, row) => {
        const skillPending = pending.get(skill.name);
        return (
          <Text key={skill.name}>
            <Text bold={row === cursor.row}>{skill.name.padEnd(nameWidth)} </Text>
            {agents.map((agent) => {
              const record = installations[installationKey(skill.name, agent.id)];
              const status: InstallationStatus | undefined = record?.status;
              const isCursorCell =
                row === cursor.row && agent.enabled && agent.enabledOrdinal === cursor.col;
              return (
                <Text
                  key={agent.id}
                  dimColor={!agent.enabled}
                  color={status === "conflict" || status === "broken-link" || status === "external" ? "yellow" : undefined}
                >
                  {formatCell(cellSymbol(status, skillPending?.get(agent.id)), isCursorCell)}
                </Text>
              );
            })}
          </Text>
        );
      })}
      {enabledAgents.length === 0 ? <Text dimColor>No enabled agents — nothing to install.</Text> : null}
      {skills.length === 0 ? <Text dimColor>No skills indexed. Run `asm refresh`.</Text> : null}
    </Box>
  );
}
