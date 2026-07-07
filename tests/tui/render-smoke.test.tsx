import { describe, it, expect } from "vitest"
import type { SkillRecord } from "../../src/core/models/skill.js"
import type { AgentConfig } from "../../src/core/models/config.js"

/**
 * testRender smoke（design §10）：验证 Matrix 组件在 opentui 下渲染未破坏，
 * 且 createMatrixState 响应式驱动标签更新（pending → [+]、toggle 后重渲染）。
 *
 * **运行时限制**：需要同时满足两个条件，缺一则 skip：
 * 1. opentui native FFI：仅 bun runtime 可用（`bun --bun run vitest`），
 *    vitest 默认 node worker 报 `OpenTUI native FFI is not available`。
 * 2. SolidJS JSX transform：需 vite-plugin-solid（vite transform 链）把 JSX 转为
 *    solid 响应式 getter；当前 vitest 配置未装该插件，`bun --bun` 下 FFI 可用但
 *    JSX 走 classic transform 报 `React is not defined`。
 * 故顶层探测 native FFI 可用性，不可用时整体 `describe.skipIf`。
 * 键路由/状态/projection 逻辑由纯函数测试覆盖（matrix/dialog/key-routing/source-keys）。
 * 待 vite-plugin-solid + bun vitest pool 落地后，本测试自动启用。
 */

let nativeOk = false
try {
  const mod = await import("@opentui/solid")
  const t = await mod.testRender(() => null as never, { width: 2, height: 2 })
  t.renderer.destroy()
  nativeOk = true
} catch {
  nativeOk = false
}

function makeSkill(name: string): SkillRecord {
  return { name, displayName: name, description: undefined, tags: [], status: "managed", candidates: [] }
}

/** 测试用 mock 翻译：直接返回 key（表头断言不依赖译文）。 */
const mockT = ((key: string) => key) as never

describe.skipIf(!nativeOk)("testRender smoke — Matrix 组件", () => {
  it("渲染表头与 [off] 单元格标签", async () => {
    const { testRender } = await import("@opentui/solid")
    const { Matrix } = await import("../../src/tui/components/Matrix.js")
    const { createMatrixState } = await import("../../src/tui/state/matrix.js")
    const { buildAgentColumns } = await import("../../src/tui/state/projection.js")
    const { theme } = await import("../../src/tui/theme/index.js")

    const matrix = createMatrixState()
    const agents: Record<string, AgentConfig> = { claude: { name: "Claude", enabled: true } }
    const t = await testRender(
      () => (
        <Matrix
          rows={[makeSkill("alpha")]}
          columns={buildAgentColumns(agents)}
          installations={{}}
          matrix={matrix}
          theme={theme}
          t={mockT}
          viewport={5}
        />
      ),
      { width: 60, height: 10 }
    )
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("alpha")
    expect(frame).toContain("[off]")
    t.renderer.destroy()
  })

  it("pending install 后响应式重渲染为 [+]", async () => {
    const { testRender } = await import("@opentui/solid")
    const { Matrix } = await import("../../src/tui/components/Matrix.js")
    const { createMatrixState } = await import("../../src/tui/state/matrix.js")
    const { buildAgentColumns } = await import("../../src/tui/state/projection.js")
    const { theme } = await import("../../src/tui/theme/index.js")

    const matrix = createMatrixState()
    const columns = buildAgentColumns({ claude: { name: "Claude", enabled: true } })
    const t = await testRender(
      () => (
        <Matrix
          rows={[makeSkill("alpha")]}
          columns={columns}
          installations={{}}
          matrix={matrix}
          theme={theme}
          t={mockT}
          viewport={5}
        />
      ),
      { width: 60, height: 10 }
    )
    await t.flush()
    expect(t.captureCharFrame()).toContain("[off]")
    matrix.setIntent("alpha", "claude", "install")
    await t.flush()
    expect(t.captureCharFrame()).toContain("[+]")
    t.renderer.destroy()
  })
})
