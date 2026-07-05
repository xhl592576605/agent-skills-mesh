import { RGBA } from "@opentui/core"

/**
 * TUI 主题（design §8）。
 *
 * 深色底 + 黄/绿/蓝强调色，与 opentui 原生 RGBA 配合：
 * - `primary`（蓝）光标/高亮
 * - `success`（绿）installed / [on]
 * - `warning`（黄）conflict / [!]
 * - `danger`（红）删除/错误
 * - `accent`（浅蓝）链接
 * - `overlay` 半透明遮罩（RGBA.fromInts，弹窗专用）
 *
 * 颜色仅辅助，所有状态另有文字标签冗余（AC7 可访问性）。
 */
export interface Theme {
  background: RGBA
  backgroundPanel: RGBA
  text: RGBA
  textMuted: RGBA
  primary: RGBA
  success: RGBA
  warning: RGBA
  danger: RGBA
  accent: RGBA
  /** 弹窗半透明遮罩（150/255 alpha）。 */
  overlay: RGBA
}

export const theme: Theme = {
  background: RGBA.fromHex("#0e1116"),
  backgroundPanel: RGBA.fromHex("#161b22"),
  text: RGBA.fromHex("#e6edf3"),
  textMuted: RGBA.fromHex("#7d8590"),
  primary: RGBA.fromHex("#58a6ff"),
  success: RGBA.fromHex("#3fb950"),
  warning: RGBA.fromHex("#d29922"),
  danger: RGBA.fromHex("#f85149"),
  accent: RGBA.fromHex("#79c0ff"),
  overlay: RGBA.fromInts(0, 0, 0, 150)
}
