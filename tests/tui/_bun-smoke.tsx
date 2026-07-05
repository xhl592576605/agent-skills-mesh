// 手动 testRender smoke 工具（不在 vitest 内跑——opentui native FFI 仅 bun runtime 可用，
// vitest worker 为 node 会报 `OpenTUI native FFI is not available`）。
//
// 用途：child-2/3/4 重构 TUI 后，手动验证 Matrix 渲染 + 响应式 + createSkillAgentKeyHandler
// 键路由集成（down/enter/r/ctrl+r//搜索）未破坏。
//
// 用法：bun run tests/tui/_bun-smoke.tsx
// 预期：打印初始 frame（[off]）、toggle 后 [+]、r 触发 review、ctrl+r fallthrough、搜索吞字符。
import { testRender } from "@opentui/solid"
import { Matrix } from "../../src/tui/components/Matrix.js"
import { createMatrixState } from "../../src/tui/state/matrix.js"
import { buildAgentColumns } from "../../src/tui/state/projection.js"
import { createSearchState } from "../../src/tui/state/search.js"
import { theme } from "../../src/tui/theme/index.js"
import { createSkillAgentKeyHandler } from "../../src/tui/state/skill-agent-keys.js"
import type { SkillRecord } from "../../src/core/models/skill.js"

const skill = (name: string): SkillRecord => ({
  name,
  displayName: name,
  description: undefined,
  tags: [],
  status: "managed",
  candidates: []
})

const matrix = createMatrixState()
const search = createSearchState()
const columns = buildAgentColumns({
  claude: { name: "Claude", enabled: true },
  cursor: { name: "Cursor", enabled: true }
})
const rows = [skill("alpha"), skill("beta")]

const t = await testRender(
  () => (
    <Matrix
      rows={rows}
      columns={columns}
      installations={{}}
      matrix={matrix}
      theme={theme}
      viewport={5}
    />
  ),
  { width: 70, height: 10 }
)
await t.flush()
console.log("=== 初始 frame（应见 alpha/beta + [off]）===")
console.log(t.captureCharFrame())

// 键路由集成：createSkillAgentKeyHandler 派发 down → cursor 移动；enter → toggle pending。
const onReviewCalls: number[] = []
const handler = createSkillAgentKeyHandler({
  matrix,
  search,
  rows: () => rows,
  columns: () => columns,
  installations: () => ({}),
  viewport: () => 5,
  onReview: () => onReviewCalls.push(1)
})

const k = (name: string, seq = name, ctrl = false) => ({ name, sequence: seq, ctrl, meta: false, shift: false })
handler(k("down") as never)
console.log("after down: cursor =", matrix.cursor(), "consumed(true)")
handler(k("return") as never)
await t.flush()
console.log("=== after enter toggle（alpha:claude 应为 [+]）===")
console.log(t.captureCharFrame())
console.log("intent alpha/claude =", matrix.intentFor("alpha", "claude"))

// 键冲突验证：r → review；ctrl+r → fallthrough（不 review）
handler(k("r") as never)
console.log("after r: onReview calls =", onReviewCalls.length, "(expect 1)")
const beforeCtrlR = onReviewCalls.length
const consumedCtrlR = handler(k("r", "r", true) as never)
console.log("ctrl+r consumed =", consumedCtrlR, "(expect false=交回全局 refresh); onReview still =", onReviewCalls.length, "(expect", beforeCtrlR + 0, ")")

// 搜索态：1 进搜索词（不切 tab）
handler(k("/", "/") as never)
console.log("search active =", search.active())
handler(k("1", "1") as never)
console.log("search query =", JSON.stringify(search.query()), "(expect '1')")

t.renderer.destroy()
console.log("=== SMOKE OK ===")
