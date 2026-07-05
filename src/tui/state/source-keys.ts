import type { KeyEvent } from "@opentui/core"
import type { ViewKeyHandler } from "../context/view-key.js"

/**
 * SourceView 的按键处理纯逻辑（design §6 集中路由的 view 侧 handler）。
 *
 * 与 `skill-agent-keys.ts` 同构：仅依赖纯类型 + 回调，**不依赖 opentui 运行时**
 * （KeyEvent 是 type-only import），便于在不渲染 TUI 的单元测试里直接断言键路由。
 *
 * handler 语义：返回 true=已消费（AppShell 跳过全局键），false=交回 AppShell 全局键
 * （1/2/3 切 tab、ctrl+r refresh、ESC 退出、? help）。
 *
 * 写操作（add/update/remove/enable/disable/detail）经组件注入的回调触发，回调内部
 * 串弹窗确认 + core service + data.reload/refresh（详见 SourceView.tsx）。
 */

/** `createSourceKeyHandler` 依赖：光标 accessor + 行数 + 写操作回调。 */
export interface SourceKeyDeps {
  /** 当前选中行（0-based）。 */
  cursor: () => number
  /** 可选行数（用于 move clamp）。 */
  rowCount: () => number
  /** 设置光标（已 clamp）。 */
  setCursor: (row: number) => void
  /** 写操作回调（由组件注入弹窗 + core service 链）。*/
  onAdd: () => void | Promise<void>
  onUpdate: () => void | Promise<void>
  onRemove: () => void | Promise<void>
  onEnable: () => void | Promise<void>
  onDisable: () => void | Promise<void>
  onDetail: () => void | Promise<void>
}

/**
 * 创建 SourceView 的按键 handler。
 *
 * - `↑↓`/`kj`：移动光标（clamp 到 [0, rowCount-1]）
 * - `a`/`u`/`d`/`e`/`x`/`enter`：触发对应写操作回调（返回 true 消费）
 * - 其余键（1/2/3/ctrl+r/esc/?）返回 false 交回 AppShell 全局键
 */
export function createSourceKeyHandler(deps: SourceKeyDeps): ViewKeyHandler {
  return (key: KeyEvent): boolean => {
    const k = key.name
    if (k === "up" || k === "k") {
      moveCursor(deps, -1)
      return true
    }
    if (k === "down" || k === "j") {
      moveCursor(deps, 1)
      return true
    }
    if (k === "a") {
      void deps.onAdd()
      return true
    }
    if (k === "u") {
      void deps.onUpdate()
      return true
    }
    if (k === "d") {
      void deps.onRemove()
      return true
    }
    if (k === "e") {
      void deps.onEnable()
      return true
    }
    if (k === "x") {
      void deps.onDisable()
      return true
    }
    if (k === "return") {
      void deps.onDetail()
      return true
    }
    // 1/2/3/ctrl+r/esc/? 交回 AppShell 全局键。
    return false
  }
}

/** 移动光标并 clamp 到 [0, rowCount-1]（rowCount<=0 时留 0）。 */
export function moveCursor(deps: SourceKeyDeps, delta: number): void {
  const max = Math.max(0, deps.rowCount() - 1)
  const next = Math.min(max, Math.max(0, deps.cursor() + delta))
  deps.setCursor(next)
}
