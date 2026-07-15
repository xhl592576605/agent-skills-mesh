import { For, Show, createMemo, type JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import type { Theme } from "../theme/index.js"
import { Panel } from "./Panel.js"

/**
 * 通用表格组件（design §5）。
 *
 * 统一处理：accent 竖条 + 行号 + 列分隔线 `│` + 表头 + 选中高亮。
 * 三个视图（Skill/Source/Doctor）通过传入不同的 `columns` 配置共享同一视觉语言，
 * 从根上消除"各自手拼、列宽/起点不一致导致错位"的问题。
 *
 * 组件不承载业务状态：cursor/rows/columns 均由调用方（view）以 props 注入。
 * 单元格颜色/高亮由 `Column.render` 决定（Matrix 的二维光标通过闭包判断）。
 */

/** 前缀固定宽度：accent(1) + 行号(4)。表头与数据行共用，保证起点对齐。 */
const ACCENT_WIDTH = 1
const INDEX_WIDTH = 4
/** 每列分隔线 `│ ` 占 2 字符宽，Column.width 仅指内容区。 */
const SEP_WIDTH = 2

export interface CellContent {
  text: string
  fg?: RGBA
  attributes?: number
  /** 多段着色（优先于 text/fg）：单元格内分段渲染，每段独立 fg。用于「标记+名称」同列异色。 */
  segments?: Array<{ text: string; fg?: RGBA }>
}

export interface Column<T> {
  key: string
  header: string
  /** 内容宽度（不含 `│ ` 分隔线）。 */
  width: number
  align?: "left" | "center"
  render: (row: T, ctx: { rowIndex: number; isCursorRow: boolean }) => CellContent
}

export interface SecondLineCell {
  text: string
  fg?: RGBA
}

/** 第二行内容：按列 key 索引。未提供的列渲染为空（但仍画 │ 保持竖线连续）。 */
export type SecondLine = Record<string, SecondLineCell>

export interface DataTableProps<T> {
  theme: Theme
  columns: readonly Column<T>[]
  rows: readonly T[]
  /** 当前选中行索引（-1 表示无选中）。 */
  cursor: number
  /** 滚动窗口；不传则渲染全部。 */
  viewport?: { offset: number; count: number }
  /** 行高；2 时配合 renderSecondLine 渲染两行（Source meta）。 */
  rowHeight?: 1 | 2
  /** rowHeight=2 时的第二行内容。 */
  renderSecondLine?: (row: T, ctx: { isCursorRow: boolean }) => SecondLine | null
  /** rows 为空时的占位内容（在 Panel 内渲染）。 */
  fallback?: JSX.Element
  flexGrow?: number
}

function alignText(value: string, width: number, align: "left" | "center" | undefined): string {
  const target = Math.max(1, width)
  const text = value.length > target ? value.slice(0, target) : value
  if (align === "center") {
    const left = Math.floor((target - text.length) / 2)
    return " ".repeat(Math.max(0, left)) + text
  }
  return text
}

export function DataTable<T>(props: DataTableProps<T>): JSX.Element {
  const theme = props.theme
  const rowHeight = () => props.rowHeight ?? 1

  const visibleRows = () => {
    if (!props.viewport) return props.rows.map((data, index) => ({ data, index }))
    const { offset, count } = props.viewport
    const out: { data: T; index: number }[] = []
    for (let i = 0; i < count; i++) {
      const idx = offset + i
      if (idx >= props.rows.length) break
      out.push({ data: props.rows[idx], index: idx })
    }
    return out
  }

  const renderHeaderCell = (col: Column<T>): JSX.Element => (
    <box width={col.width + SEP_WIDTH} flexDirection="row">
      <text fg={theme.border}>│ </text>
      <text width={col.width} fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
        {alignText(col.header, col.width, col.align)}
      </text>
    </box>
  )

  const renderCell = (col: Column<T>, row: T, rowIndex: number, isCursorRow: () => boolean): JSX.Element => {
    // createMemo 确保 col.render 在响应式上下文执行：内部读取的 signal（intent/cursor）
    // 变化时重算，驱动单元格文本/颜色更新。isCursorRow 以 accessor 传入，跟踪光标移动。
    const content = createMemo(() => col.render(row, { rowIndex, isCursorRow: isCursorRow() }))
    const defaultFg = () => (isCursorRow() ? theme.text : theme.textMuted)
    return (
      <box width={col.width + SEP_WIDTH} flexDirection="row">
        <text fg={theme.border}>│ </text>
        <Show
          when={content().segments}
          fallback={
            <text width={col.width} fg={content().fg ?? defaultFg()} attributes={content().attributes} wrapMode="none">
              {alignText(content().text, col.width, col.align)}
            </text>
          }
        >
          <box width={col.width} flexDirection="row">
            <For each={content().segments ?? []}>
              {(seg) => (
                <text fg={seg.fg ?? defaultFg()} attributes={content().attributes} wrapMode="none">
                  {seg.text}
                </text>
              )}
            </For>
          </box>
        </Show>
      </box>
    )
  }

  return (
    <Panel theme={theme} flexGrow={props.flexGrow ?? 1}>
      <box flexDirection="column" flexGrow={1}>
        {/* 表头：accent 占位 + 列，结构与数据行完全一致 */}
        <box flexDirection="row" backgroundColor={theme.panelMuted} height={1}>
          <box width={ACCENT_WIDTH} />
          <box flexDirection="column" flexGrow={1}>
            <box flexDirection="row" height={1}>
              <text width={INDEX_WIDTH} fg={theme.textMuted}>  </text>
              <For each={props.columns}>{renderHeaderCell}</For>
            </box>
          </box>
        </box>

        {/* 数据行（空时回退到 fallback） */}
        <Show when={props.rows.length > 0} fallback={props.fallback}>
        <For each={visibleRows()}>
          {(row) => {
            const isCursorRow = () => row.index === props.cursor
            const second = () =>
              rowHeight() === 2
                ? (props.renderSecondLine?.(row.data, { isCursorRow: isCursorRow() }) ?? null)
                : null
            return (
              <box
                flexDirection="row"
                backgroundColor={isCursorRow() ? theme.selection : theme.panel}
                height={rowHeight()}
              >
                <box width={ACCENT_WIDTH} backgroundColor={isCursorRow() ? theme.selectionAccent : undefined} />
                <box flexDirection="column" flexGrow={1}>
                  <box flexDirection="row" height={1}>
                    <text width={INDEX_WIDTH} fg={isCursorRow() ? theme.text : theme.textMuted}>
                      {String(row.index + 1).padStart(2, "0")}
                    </text>
                    <For each={props.columns}>
                      {(col) => renderCell(col, row.data, row.index, isCursorRow)}
                    </For>
                  </box>
                  <Show when={rowHeight() === 2}>
                    <box flexDirection="row" height={1}>
                      <For each={props.columns}>
                      {(col) => {
                        const cell = () => second()?.[col.key]
                        return (
                          <box width={col.width + SEP_WIDTH} flexDirection="row">
                            <text fg={theme.border}>│ </text>
                            <text width={col.width} fg={cell()?.fg ?? theme.textMuted} wrapMode="none">
                              {cell()?.text ?? ""}
                            </text>
                          </box>
                        )
                      }}
                    </For>
                    </box>
                  </Show>
                </box>
              </box>
            )
          }}
        </For>
        </Show>
      </box>
    </Panel>
  )
}

// 供 view 计算 flex 列宽度与第二行偏移的工具函数。
/** 某列内容起点的绝对 x 偏移（含 accent + index + 前面所有列的 │ 与宽度）。 */
export function columnContentOffset(columns: readonly { width: number }[], colIndex: number): number {
  let offset = ACCENT_WIDTH + INDEX_WIDTH
  for (let i = 0; i <= colIndex; i++) {
    offset += SEP_WIDTH
    if (i < colIndex) offset += columns[i].width
  }
  return offset
}

