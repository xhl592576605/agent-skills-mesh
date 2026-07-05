import { For } from "solid-js"
import type { Theme } from "../theme/index.js"
import type { InstallationRecord } from "../../core/models/installation.js"
import type { SkillRecord } from "../../core/models/skill.js"
import type { MatrixState } from "../state/matrix.js"
import {
  type AgentColumn,
  cellColor,
  cellInfo,
  installationKey
} from "../state/projection.js"

/**
 * skill×agent 表格（design §6）。
 *
 * 纯渲染组件：所有状态（cursor/pending/scroll）由父级 `matrix` 提供，本组件只读并映射为
 * 表头 + 行 + 单元格标签 + 光标高亮。可见行窗口由 `matrix.scrollOffset()` × `viewport` 切片。
 */
export interface MatrixProps {
  rows: readonly SkillRecord[]
  columns: readonly AgentColumn[]
  installations: Record<string, InstallationRecord>
  matrix: MatrixState
  theme: Theme
  /** Name 列宽（字符）。 */
  nameWidth?: number
  /** 每个 agent 列宽（字符）。 */
  cellWidth?: number
  /** 可见行数（决定滚动窗口高度）。 */
  viewport: number
}

export function Matrix(props: MatrixProps) {
  const theme = props.theme
  const nameWidth = () => props.nameWidth ?? 24
  const cellWidth = () => props.cellWidth ?? 9

  // 可见窗口（scrollOffset 起 viewport 行）。末尾不足时 slice 自动截断。
  const visibleRows = () => {
    const off = props.matrix.scrollOffset()
    return props.rows.slice(off, off + props.viewport)
  }

  return (
    <box flexDirection="column">
      {/* 表头 */}
      <box flexDirection="row" backgroundColor={theme.backgroundPanel}>
        <box width={nameWidth()} paddingLeft={1}>
          <text fg={theme.textMuted}>Name</text>
        </box>
        <For each={props.columns}>
          {(col) => (
            <box width={cellWidth()} paddingLeft={1}>
              <text fg={col.enabled ? theme.text : theme.textMuted}>
                {col.id.slice(0, Math.max(1, cellWidth() - 2))}
              </text>
            </box>
          )}
        </For>
      </box>

      {/* 数据行（可见窗口） */}
      <For each={visibleRows()}>
        {(skill, i) => {
          const absRow = () => props.matrix.scrollOffset() + i()
          const isCursorRow = () => props.matrix.cursor().row === absRow()
          return (
            <box flexDirection="row" backgroundColor={isCursorRow() ? theme.backgroundPanel : undefined}>
              <box width={nameWidth()} paddingLeft={1}>
                <text fg={isCursorRow() ? theme.text : theme.textMuted}>
                  {skill.name.length > nameWidth() - 2
                    ? skill.name.slice(0, nameWidth() - 3) + "…"
                    : skill.name}
                </text>
              </box>
              <For each={props.columns}>
                {(col, j) => {
                  const intent = () => props.matrix.intentFor(skill.name, col.id)
                  const info = () =>
                    cellInfo(
                      props.installations[installationKey(skill.name, col.id)],
                      col.enabled,
                      intent()
                    )
                  const isCursorCell = () => isCursorRow() && props.matrix.cursor().col === j()
                  return (
                    <box
                      width={cellWidth()}
                      paddingLeft={1}
                      backgroundColor={isCursorCell() ? theme.primary : undefined}
                    >
                      <text fg={isCursorCell() ? theme.backgroundPanel : cellColor(info().kind, theme)}>
                        {info().label}
                      </text>
                    </box>
                  )
                }}
              </For>
            </box>
          )
        }}
      </For>
    </box>
  )
}
