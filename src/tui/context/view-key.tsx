import { createContext, useContext } from "solid-js"
import type { KeyEvent } from "@opentui/core"

/**
 * View 按键 handler 注册通道（design §6 集中键盘路由）。
 *
 * **背景**：opentui 的 `useKeyboard` 无 stopPropagation 语义（多订阅都收到同一按键），
 * 若 AppShell 和各 view 各自注册 useKeyboard 会双触发。故设计为 **AppShell 单一
 * useKeyboard 集中路由**：按 `dialog.isOpen()` → 全局键 → 当前 view 的 `onKey` 顺序派发。
 *
 * View 通过本 context 把自己的 handler 注册给 AppShell（onMount 注册、onCleanup 注销），
 * 不再自注册 useKeyboard。handler 返回 `true` 表示已消费（AppShell 不再处理全局键，
 * 用于搜索态吞字符），返回 `false` 表示交回 AppShell 处理全局键。
 */
export type ViewKeyHandler = (key: KeyEvent) => boolean

export interface ViewKeyContextValue {
  /** View 注册/注销按键 handler。传 null 注销。 */
  setHandler: (handler: ViewKeyHandler | null) => void
}

const ViewKeyContext = createContext<ViewKeyContextValue>()

export const ViewKeyProvider = ViewKeyContext.Provider

export function useViewKey(): ViewKeyContextValue {
  const value = useContext(ViewKeyContext)
  if (!value) throw new Error("useViewKey must be used within a ViewKeyProvider")
  return value
}
