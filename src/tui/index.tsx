import { render } from "@opentui/solid"
import { App } from "./App.js"

/**
 * TUI 渲染入口（design §5）。
 *
 * `run()` 由 `src/cli/index.ts` 的 `tui` command 懒加载调用：
 * ```ts
 * const { run } = await import("../tui/index.js")
 * run()
 * ```
 *
 * ⚠️ APFS 大小写不敏感：本文件必须是 `index.tsx`（含 JSX，run 导出 + render），
 * 不能同时存在 `index.ts` 或 `app.tsx`（与 App.tsx 冲突）。
 */
export function run(): void {
  // render 是 async，但 TUI 入口不需 await（进程由 renderer 事件循环维持，
  // ESC 时 AppShell 调 renderer.destroy() + process.exit(0) 退出）。
  // exitOnCtrlC=false：交由 AppShell 统一处理 ctrl+c（弹窗开→关弹窗，否则→退出），
  // 避免弹窗时 ctrl+c 直接杀掉 TUI（prd AC：ctrl+c 关弹窗）。
  void render(() => <App />, { exitOnCtrlC: false })
}
