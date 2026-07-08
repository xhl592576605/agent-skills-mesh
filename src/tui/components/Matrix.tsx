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
import { type TranslateFn } from "../context/i18n.js"
import { DataTable, type Column } from "./DataTable.js"

/**
 * skill×agent 表格（design §5.2）。
 *
 * 纯渲染组件：所有状态（cursor/pending/scroll）由父级 `matrix` 提供，本组件只把
 * skill 行 × agent 列映射为 `DataTable` 的 `columns` 配置。视觉效果（accent/行号/
 * 分隔线/选中高亮）统一由 `DataTable` 处理，避免与 Source/Doctor 各自手拼产生错位。
 */
export interface MatrixProps {
  rows: readonly SkillRecord[]
  columns: readonly AgentColumn[]
  installations: Record<string, InstallationRecord>
  matrix: MatrixState
  theme: Theme
  t: TranslateFn
  nameWidth?: number
  cellWidth?: number
  viewport: number
}

export function Matrix(props: MatrixProps) {
  const theme = props.theme
  const nameWidth = () => props.nameWidth ?? 28
  const cellWidth = () => props.cellWidth ?? 12

  // DataTable 列定义：name 列 + 每个 agent 列。
  // agent 列的 render 闭包捕获 colIndex，用于判断二维光标单元格高亮。
  const tableColumns = (): Column<SkillRecord>[] => {
    const cols: Column<SkillRecord>[] = [
      {
        key: "name",
        header: props.t("table.name"),
        width: nameWidth(),
        render: (skill, ctx) => ({
          text: skill.name,
          fg: ctx.isCursorRow ? theme.text : theme.textMuted
        })
      }
    ]
    props.columns.forEach((agentCol, colIdx) => {
      cols.push({
        key: agentCol.id,
        header: agentCol.id,
        width: cellWidth(),
        align: "center",
        render: (skill, ctx) => {
          const intent = props.matrix.intentFor(skill.name, agentCol.id)
          const info = cellInfo(
            props.installations[installationKey(skill.name, agentCol.id)],
            agentCol.enabled,
            intent
          )
          const isCursorCell = ctx.isCursorRow && props.matrix.cursor().col === colIdx
          return {
            text: info.label,
            fg: isCursorCell ? theme.primary : cellColor(info.kind, theme)
          }
        }
      })
    })
    return cols
  }

  const viewport = () => ({
    offset: props.matrix.scrollOffset(),
    count: props.viewport
  })

  return (
    <DataTable
      theme={theme}
      columns={tableColumns()}
      rows={props.rows}
      cursor={props.matrix.cursor().row}
      viewport={viewport()}
      rowHeight={1}
      flexGrow={1}
    />
  )
}
