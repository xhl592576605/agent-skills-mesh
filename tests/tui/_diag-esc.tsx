// 临时诊断：testRender 下 ESC / ctrl+c / return 的 KeyEvent.name 是什么。
//
// 发现（child-3）：pressEscape() 在 testRender 下生成的 KeyEvent.name 是 **空字符串**
// （seq="\u001b\u001b"），而非真终端的 "escape"。故 AppShell `key.name === "escape"` 在
// mock 下不匹配，smoke 无法验证 ESC 关闭——这是 testRender 的 mock 差异，生产代码对
// 真终端正确（child-1 ConfirmDialog ESC 已 prd AC 验证）。保留此工具供未来键位调试。
import { testRender, useKeyboard } from "@opentui/solid"
import { KeyCodes } from "@opentui/core/testing"

const seen: string[] = []
const Comp = () => {
  useKeyboard((key) => {
    seen.push(`name=${key.name} seq=${JSON.stringify(key.sequence)} ctrl=${key.ctrl}`)
  })
  return <text>diag</text>
}

const t = await testRender(() => <Comp />, { width: 20, height: 3 })
await t.flush()

t.mockInput.pressEnter()
t.mockInput.pressEscape()
t.mockInput.pressKey(KeyCodes.ESCAPE)
t.mockInput.pressKey("a")
t.mockInput.pressCtrlC()
await t.flush()
await t.flush()

console.log("seen keys:")
for (const s of seen) console.log("  " + s)
t.renderer.destroy()
