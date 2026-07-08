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
 *
 * 颜色仅辅助，所有状态另有文字标签冗余（AC7 可访问性）。
 */
export interface Theme {
  background: RGBA
  backgroundAlt: RGBA
  backgroundPanel: RGBA
  panel: RGBA
  panelMuted: RGBA
  border: RGBA
  borderStrong: RGBA
  selection: RGBA
  selectionAccent: RGBA
  keyBg: RGBA
  keyBorder: RGBA
  cyan: RGBA
  text: RGBA
  textMuted: RGBA
  primary: RGBA
  success: RGBA
  warning: RGBA
  danger: RGBA
  accent: RGBA
  textHighlight: RGBA
  /** 弹窗半透明遮罩（alpha 越低背景越清晰）。 */
  overlay: RGBA
}

export const theme: Theme = {
  background: RGBA.fromHex("#07111a"),
  backgroundAlt: RGBA.fromHex("#08131d"),
  backgroundPanel: RGBA.fromHex("#161b22"),
  panel: RGBA.fromHex("#0b1823"),
  panelMuted: RGBA.fromHex("#101c29"),
  border: RGBA.fromHex("#2b3d4f"),
  borderStrong: RGBA.fromHex("#1f6feb"),
  selection: RGBA.fromHex("#142b5f"),
  selectionAccent: RGBA.fromHex("#2f9bff"),
  keyBg: RGBA.fromHex("#111d2b"),
  keyBorder: RGBA.fromHex("#33465a"),
  cyan: RGBA.fromHex("#42d5e8"),
  text: RGBA.fromHex("#e6edf3"),
  textMuted: RGBA.fromHex("#9aa8bd"),
  primary: RGBA.fromHex("#3da5ff"),
  success: RGBA.fromHex("#35d058"),
  warning: RGBA.fromHex("#e3b341"),
  danger: RGBA.fromHex("#ff5c57"),
  accent: RGBA.fromHex("#79c0ff"),
  textHighlight: RGBA.fromHex("#e6edf3"),
  overlay: RGBA.fromInts(0, 0, 0, 12)
}
