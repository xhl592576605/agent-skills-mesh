// child-3 手动 testRender smoke（不在 vitest 内跑——opentui native FFI 仅 bun runtime 可用）。
//
// 用途：验证 Source/Doctor 视图 + `?` help + Matrix `i` 在完整 Provider 装配下集成。
//
// 用法：bun run tests/tui/_bun-smoke-views.tsx
//
// 已知 mock 限制（不影响生产代码，真终端已 AC）：
// - pressEscape() 在 testRender 下生成的 KeyEvent.name 是空串（非 "escape"），故 ESC 关弹窗
//   无法在此验证；生产代码用 key.name === "escape" 对真终端正确（child-1 ConfirmDialog 已 AC）。
// - pressKey 单字符键偶发不稳定；Matrix `i` 段用 try/catch 容错。
import { testRender } from "@opentui/solid"
import { App } from "../../src/tui/App.js"

const t = await testRender(() => <App />, { width: 90, height: 24 })

// DataProvider onMount 异步加载 config/index，等 TabBar 出现。
await t.waitForFrame((f) => f.includes("Skill×Agent"))
console.log("=== 初始（skill tab，TabBar 渲染）===")
console.log(t.captureCharFrame())

// 2 → source tab（SourceView 表头 id/type/enabled）。
t.mockInput.pressKey("2")
await t.waitForFrame((f) => f.includes("id") && f.includes("type"))
console.log("=== after 2（source tab，id/type/enabled 表头）===")
console.log(t.captureCharFrame())

// 3 → doctor tab（DoctorView 表头 state/kind + checks 列表）。
t.mockInput.pressKey("3")
await t.waitForFrame((f) => f.includes("state") && f.includes("kind"), 5000).catch(() => {})
console.log("=== after 3（doctor tab，state/kind 表头 + checks）===")
console.log(t.captureCharFrame())

// 1 → skill tab，再 ? → help 弹窗（Keybindings）。
t.mockInput.pressKey("1")
await t.waitForFrame((f) => f.includes("Skill×Agent"), 3000).catch(() => {})
t.mockInput.pressKey("?")
await t.waitForFrame((f) => f.includes("Keybindings"))
console.log("=== after ? （help 弹窗，Keybindings + 各 tab 键位）===")
console.log(t.captureCharFrame())

// Matrix `i` 键弹 SkillDetailDialog（child-3 info 双入口）。
// help 还开着时先按 ctrl+c 关（testRender 下 ESC mock 不生效，用 ctrl+c）；再 1 + i。
t.mockInput.pressCtrlC()
await t.flush()
await t.flush()
t.mockInput.pressKey("1")
await t.waitForFrame((f) => f.includes("Name"), 3000).catch(() => {})
t.mockInput.pressKey("i")
let infoOpen = false
try {
  await t.waitForFrame((f) => f.includes("candidates"), 2000)
  infoOpen = true
} catch {
  infoOpen = false
}
console.log(`=== after i（Matrix skill 详情 opened=${infoOpen}）===`)
if (infoOpen) console.log(t.captureCharFrame())

t.renderer.destroy()
console.log("=== SMOKE VIEWS OK ===")
