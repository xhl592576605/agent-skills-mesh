import type { KeyEvent } from "@opentui/core"
import type { ViewKeyHandler } from "../context/view-key.js"

/**
 * AppShell 集中键盘路由（design §6）。
 *
 * opentui 的 `useKeyboard` 无 stopPropagation，多订阅都收同一按键会双触发，故 AppShell
 * 唯一订阅 useKeyboard，把按键交给本纯函数派发。优先级（短路返回）：
 *
 * 1. **弹窗打开** → 仅 ESC/ctrl+c 关栈顶（吞，不退出、不派发 view）；其余键交弹窗内部组件（吞，不派发）
 * 2. **view handler 优先消费** → 返回 true 表示已处理（搜索态吞字符、Matrix/Source/Doctor 操作键），
 *    AppShell 不再处理全局键。这让搜索态能把 `1`/`2`/`3`/字母收为过滤词而非切 tab
 * 3. **全局键**（view 未消费）→ `1`/`2`/`3` 切 tab、`ctrl+r` refresh、`?` help、`ESC`/`ctrl+c` 退出
 *
 * 提取为纯工厂便于 `tests/tui/key-routing.test.ts` 构造 KeyEvent 直接断言派发顺序，
 * 不依赖 opentui 渲染（native FFI 在 vitest worker 不可用）。
 */

export type AppTab = "skill" | "source" | "doctor"

export interface AppShellKeyDeps {
  /** 弹窗是否打开（让出全局键）。 */
  isOpen: () => boolean
  /** 关闭栈顶弹窗（ESC/ctrl+c 在弹窗打开时）。 */
  closeTop: () => void
  /** view 注册的按键 handler（null=未注册）。返回 true=已消费。 */
  getViewHandler: () => ViewKeyHandler | null
  /** 切换 tab（1/2/3 全局键）。 */
  setTab: (tab: AppTab) => void
  /** 全局刷新（ctrl+r）。 */
  refresh: () => void
  /** 帮助弹窗（?）。 */
  showHelp: () => void
  /** 退出 TUI（ESC/ctrl+c 在无弹窗时）。 */
  exit: () => void
  /** 语言热切换（shift+L）：zh↔en 互切并写回 config。 */
  toggleLang: () => void
}

/**
 * 构造 AppShell 按键派发器。返回的 handler 直接传给 `useKeyboard(cb)`。
 *
 * 注意：view handler 在每次按键时重新读取（`getViewHandler()`），保证拿到最新注册的
 * handler（view 用普通变量持有、setHandler 覆盖，无需响应式重渲染）。
 */
export function createAppShellKeyHandler(deps: AppShellKeyDeps): (key: KeyEvent) => void {
  return (key) => {
    // 1. 弹窗优先：吞所有键，仅 ESC/ctrl+c 关栈顶
    if (deps.isOpen()) {
      if (key.name === "escape" || (key.ctrl && key.name === "c")) deps.closeTop()
      return
    }
    // 1.5 语言热切换（shift+L，全局优先）：key.name 恒小写，大写看 key.shift（solid-patterns）。
    //     前置于 view handler，确保不被搜索态吞字符、不被 matrix hjkl 的 l 右移拦截
    //     （普通 l 无 shift 仍落 view handler 正常右移）。
    if (key.name === "l" && key.shift) {
      deps.toggleLang()
      return
    }
    // 2. view handler 优先消费（返回 true=吞，不再派发全局键）
    const handler = deps.getViewHandler()
    if (handler && handler(key)) return
    // 3. 全局键
    if (key.name === "1") {
      deps.setTab("skill")
    } else if (key.name === "2") {
      deps.setTab("source")
    } else if (key.name === "3") {
      deps.setTab("doctor")
    } else if (key.ctrl && key.name === "r") {
      deps.refresh()
    } else if (key.sequence === "?") {
      deps.showHelp()
    } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      deps.exit()
    }
  }
}
