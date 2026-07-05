import { describe, it, expect, vi } from "vitest"
import {
  createSourceKeyHandler,
  moveCursor,
  type SourceKeyDeps
} from "../../src/tui/state/source-keys.js"
import type { KeyEvent } from "@opentui/core"

/**
 * SourceView 按键 handler 纯逻辑测试（design §6，与 matrix.test.ts 同款）。
 *
 * 覆盖 createSourceKeyHandler 键路由（移动 + 写操作回调触发 + fallthrough）+
 * moveCursor clamp 边界。不依赖 opentui 渲染，纯函数断言。
 */

/** 构造最小 KeyEvent mock（handler 只读 name/sequence/ctrl/meta）。 */
function key(
  name: string,
  opts: { sequence?: string; ctrl?: boolean; meta?: boolean } = {}
): KeyEvent {
  return {
    name,
    sequence: opts.sequence ?? name,
    ctrl: opts.ctrl ?? false,
    meta: opts.meta ?? false,
    shift: false
  } as unknown as KeyEvent
}

/** 构造 handler 依赖（光标可变 + 6 个回调 mock）。 */
function makeDeps(overrides: Partial<SourceKeyDeps> = {}): SourceKeyDeps {
  let cursor = 0
  return {
    cursor: () => cursor,
    rowCount: () => 3,
    setCursor: (row: number) => {
      cursor = row
    },
    onAdd: vi.fn(),
    onUpdate: vi.fn(),
    onRemove: vi.fn(),
    onEnable: vi.fn(),
    onDisable: vi.fn(),
    onDetail: vi.fn(),
    ...overrides
  }
}

describe("createSourceKeyHandler — 移动键", () => {
  it("↑/k 向上移动并消费", () => {
    const deps = makeDeps()
    const setCursor = vi.fn()
    deps.setCursor = setCursor
    deps.cursor = () => 2
    const handler = createSourceKeyHandler(deps)
    expect(handler(key("up"))).toBe(true)
    expect(setCursor).toHaveBeenCalledWith(1)
    expect(handler(key("k"))).toBe(true)
    expect(setCursor).toHaveBeenCalledWith(1)
  })

  it("↓/j 向下移动并消费", () => {
    const deps = makeDeps()
    const setCursor = vi.fn()
    deps.setCursor = setCursor
    deps.cursor = () => 0
    const handler = createSourceKeyHandler(deps)
    expect(handler(key("down"))).toBe(true)
    expect(setCursor).toHaveBeenCalledWith(1)
    expect(handler(key("j"))).toBe(true)
  })
})

describe("createSourceKeyHandler — 写操作回调", () => {
  it("a 触发 onAdd", () => {
    const deps = makeDeps()
    const handler = createSourceKeyHandler(deps)
    expect(handler(key("a"))).toBe(true)
    expect(deps.onAdd).toHaveBeenCalledOnce()
  })

  it("u 触发 onUpdate", () => {
    const deps = makeDeps()
    const handler = createSourceKeyHandler(deps)
    expect(handler(key("u"))).toBe(true)
    expect(deps.onUpdate).toHaveBeenCalledOnce()
  })

  it("d 触发 onRemove（不与 down 冲突）", () => {
    const deps = makeDeps()
    const handler = createSourceKeyHandler(deps)
    expect(handler(key("d"))).toBe(true)
    expect(deps.onRemove).toHaveBeenCalledOnce()
  })

  it("e 触发 onEnable", () => {
    const deps = makeDeps()
    const handler = createSourceKeyHandler(deps)
    expect(handler(key("e"))).toBe(true)
    expect(deps.onEnable).toHaveBeenCalledOnce()
  })

  it("x 触发 onDisable", () => {
    const deps = makeDeps()
    const handler = createSourceKeyHandler(deps)
    expect(handler(key("x"))).toBe(true)
    expect(deps.onDisable).toHaveBeenCalledOnce()
  })

  it("enter 触发 onDetail", () => {
    const deps = makeDeps()
    const handler = createSourceKeyHandler(deps)
    expect(handler(key("return"))).toBe(true)
    expect(deps.onDetail).toHaveBeenCalledOnce()
  })
})

describe("createSourceKeyHandler — fallthrough 交回 AppShell", () => {
  it("1/2/3 切 tab 键返回 false（交回 AppShell）", () => {
    const deps = makeDeps()
    const handler = createSourceKeyHandler(deps)
    expect(handler(key("1"))).toBe(false)
    expect(handler(key("2"))).toBe(false)
    expect(handler(key("3"))).toBe(false)
  })

  it("ctrl+r 返回 false（交回 AppShell refresh）", () => {
    const deps = makeDeps()
    const handler = createSourceKeyHandler(deps)
    expect(handler(key("r", { ctrl: true }))).toBe(false)
  })

  it("escape 返回 false（交回 AppShell 退出）", () => {
    const deps = makeDeps()
    const handler = createSourceKeyHandler(deps)
    expect(handler(key("escape"))).toBe(false)
  })

  it("? help 返回 false（交回 AppShell 弹 help）", () => {
    const deps = makeDeps()
    const handler = createSourceKeyHandler(deps)
    expect(handler(key("?", { sequence: "?" }))).toBe(false)
  })

  it("写操作回调未被 fallthrough 键触发", () => {
    const deps = makeDeps()
    const handler = createSourceKeyHandler(deps)
    handler(key("1"))
    handler(key("escape"))
    expect(deps.onAdd).not.toHaveBeenCalled()
    expect(deps.onRemove).not.toHaveBeenCalled()
  })
})

describe("moveCursor — clamp 边界", () => {
  it("向上 clamp 到 0（不越界）", () => {
    const deps = makeDeps({ cursor: () => 0, rowCount: () => 3 })
    const setCursor = vi.fn()
    deps.setCursor = setCursor
    moveCursor(deps, -1)
    expect(setCursor).toHaveBeenCalledWith(0)
  })

  it("向下 clamp 到 rowCount-1", () => {
    const deps = makeDeps({ cursor: () => 2, rowCount: () => 3 })
    const setCursor = vi.fn()
    deps.setCursor = setCursor
    moveCursor(deps, 1)
    expect(setCursor).toHaveBeenCalledWith(2)
  })

  it("rowCount=0 时 clamp 到 0（不 NaN）", () => {
    const deps = makeDeps({ cursor: () => 5, rowCount: () => 0 })
    const setCursor = vi.fn()
    deps.setCursor = setCursor
    moveCursor(deps, 1)
    expect(setCursor).toHaveBeenCalledWith(0)
  })

  it("负 delta 跨多行仍 clamp", () => {
    const deps = makeDeps({ cursor: () => 1, rowCount: () => 5 })
    const setCursor = vi.fn()
    deps.setCursor = setCursor
    moveCursor(deps, -10)
    expect(setCursor).toHaveBeenCalledWith(0)
  })
})
