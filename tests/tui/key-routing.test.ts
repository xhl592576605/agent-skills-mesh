import { describe, it, expect, vi } from "vitest"
import { createAppShellKeyHandler, type AppShellKeyDeps } from "../../src/tui/state/app-keys.js"
import type { KeyEvent } from "@opentui/core"

/**
 * AppShell 集中键盘路由派发测试（design §6，prd A）。
 *
 * 覆盖三级优先级：①弹窗打开→吞（仅 ESC/ctrl+c 关栈顶）；②view handler 消费（返回 true 吞）；
 * ③全局键（1/2/3/ctrl+r/?/ESC/ctrl+c）。重点验证 ctrl+r vs r 区分、搜索态 view 吞字符
 * 不切 tab、view handler 读取最新引用（每次按键重读）。
 *
 * 构造 KeyEvent 直接调 handler，不依赖 opentui 渲染（prd：纯函数测）。
 */

/** 构造最小 KeyEvent mock（handler 只读 name/sequence/ctrl）。 */
function key(
  name: string,
  opts: { sequence?: string; ctrl?: boolean; meta?: boolean; shift?: boolean } = {}
): KeyEvent {
  return {
    name,
    sequence: opts.sequence ?? name,
    ctrl: opts.ctrl ?? false,
    meta: opts.meta ?? false,
    shift: opts.shift ?? false
  } as unknown as KeyEvent
}

/** 构造 deps mock，所有副作用用 vi.fn 记录。 */
function makeDeps(overrides: Partial<AppShellKeyDeps> = {}): AppShellKeyDeps {
  return {
    isOpen: () => false,
    closeTop: vi.fn(),
    getViewHandler: () => null,
    setTab: vi.fn(),
    refresh: vi.fn(),
    showHelp: vi.fn(),
    exit: vi.fn(),
    toggleLang: vi.fn(),
    ...overrides
  }
}

describe("createAppShellKeyHandler — 弹窗优先（isOpen=true）", () => {
  it("ESC 调 closeTop", () => {
    const deps = makeDeps({ isOpen: () => true })
    createAppShellKeyHandler(deps)(key("escape"))
    expect(deps.closeTop).toHaveBeenCalledOnce()
  })

  it("ctrl+c 调 closeTop", () => {
    const deps = makeDeps({ isOpen: () => true })
    createAppShellKeyHandler(deps)(key("c", { ctrl: true }))
    expect(deps.closeTop).toHaveBeenCalledOnce()
  })

  it("非 ESC/ctrl+c 键不调 closeTop、不派发 view、不触发全局键（吞）", () => {
    const viewHandler = vi.fn(() => true)
    const deps = makeDeps({ isOpen: () => true, getViewHandler: () => viewHandler })
    createAppShellKeyHandler(deps)(key("1"))
    expect(deps.closeTop).not.toHaveBeenCalled()
    expect(viewHandler).not.toHaveBeenCalled() // 弹窗打开时 view 不参与
    expect(deps.setTab).not.toHaveBeenCalled()
  })

  it("弹窗打开时 return 不切 tab、不 refresh", () => {
    const deps = makeDeps({ isOpen: () => true })
    const h = createAppShellKeyHandler(deps)
    h(key("1"))
    h(key("return"))
    h(key("r", { ctrl: true }))
    expect(deps.setTab).not.toHaveBeenCalled()
    expect(deps.refresh).not.toHaveBeenCalled()
  })
})

describe("createAppShellKeyHandler — view handler 优先消费", () => {
  it("view handler 返回 true → 不触发全局键", () => {
    const viewHandler = vi.fn(() => true)
    const deps = makeDeps({ getViewHandler: () => viewHandler })
    createAppShellKeyHandler(deps)(key("1"))
    expect(viewHandler).toHaveBeenCalledOnce()
    expect(deps.setTab).not.toHaveBeenCalled() // 被吞，不切 tab
  })

  it("view handler 返回 false → 触发全局键（fallthrough）", () => {
    const viewHandler = vi.fn(() => false)
    const deps = makeDeps({ getViewHandler: () => viewHandler })
    createAppShellKeyHandler(deps)(key("1"))
    expect(viewHandler).toHaveBeenCalledOnce()
    expect(deps.setTab).toHaveBeenCalledWith("skill")
  })

  it("view handler 为 null → 直接全局键", () => {
    const deps = makeDeps({ getViewHandler: () => null })
    createAppShellKeyHandler(deps)(key("2"))
    expect(deps.setTab).toHaveBeenCalledWith("source")
  })

  it("搜索态 view 吞字符：1/2/3/a 被 view 收下，不切 tab/不触发全局", () => {
    // 模拟 SkillAgentView 搜索态 handler：可打印字符返回 true（吞）
    const viewHandler = vi.fn((_k: KeyEvent) => true)
    const deps = makeDeps({ getViewHandler: () => viewHandler })
    const h = createAppShellKeyHandler(deps)
    h(key("1", { sequence: "1" }))
    h(key("a", { sequence: "a" }))
    expect(viewHandler).toHaveBeenCalledTimes(2)
    expect(deps.setTab).not.toHaveBeenCalled()
    expect(deps.refresh).not.toHaveBeenCalled()
    expect(deps.exit).not.toHaveBeenCalled()
  })

  it("每次按键重读 getViewHandler（handler 替换后用新的）", () => {
    let current: ((k: KeyEvent) => boolean) | null = null
    const deps = makeDeps({ getViewHandler: () => current })
    const h = createAppShellKeyHandler(deps)
    current = null
    h(key("1")) // 无 handler → 全局键切 tab
    expect(deps.setTab).toHaveBeenCalledWith("skill")
    current = () => true
    h(key("1")) // 有 handler 且吞 → 不切 tab
    expect(deps.setTab).toHaveBeenCalledTimes(1) // 仍是 1 次（第二次被吞）
    current = null
    h(key("2"))
    expect(deps.setTab).toHaveBeenCalledWith("source")
  })
})

describe("createAppShellKeyHandler — 全局键 fallthrough", () => {
  it("1 → setTab(skill)", () => {
    const deps = makeDeps()
    createAppShellKeyHandler(deps)(key("1"))
    expect(deps.setTab).toHaveBeenCalledWith("skill")
  })

  it("2 → setTab(source)", () => {
    const deps = makeDeps()
    createAppShellKeyHandler(deps)(key("2"))
    expect(deps.setTab).toHaveBeenCalledWith("source")
  })

  it("3 → setTab(doctor)", () => {
    const deps = makeDeps()
    createAppShellKeyHandler(deps)(key("3"))
    expect(deps.setTab).toHaveBeenCalledWith("doctor")
  })

  it("? → showHelp", () => {
    const deps = makeDeps()
    createAppShellKeyHandler(deps)(key("?", { sequence: "?" }))
    expect(deps.showHelp).toHaveBeenCalledOnce()
  })

  it("ESC → exit", () => {
    const deps = makeDeps()
    createAppShellKeyHandler(deps)(key("escape"))
    expect(deps.exit).toHaveBeenCalledOnce()
  })

  it("ctrl+c → exit", () => {
    const deps = makeDeps()
    createAppShellKeyHandler(deps)(key("c", { ctrl: true }))
    expect(deps.exit).toHaveBeenCalledOnce()
  })

  it("未知键不触发任何副作用", () => {
    const deps = makeDeps()
    const h = createAppShellKeyHandler(deps)
    h(key("z"))
    h(key("x"))
    expect(deps.setTab).not.toHaveBeenCalled()
    expect(deps.refresh).not.toHaveBeenCalled()
    expect(deps.showHelp).not.toHaveBeenCalled()
    expect(deps.exit).not.toHaveBeenCalled()
  })
})

describe("createAppShellKeyHandler — ctrl+r vs r 区分", () => {
  it("ctrl+r → refresh（全局）", () => {
    const deps = makeDeps()
    createAppShellKeyHandler(deps)(key("r", { ctrl: true }))
    expect(deps.refresh).toHaveBeenCalledOnce()
  })

  it("r（无 ctrl）不触发 refresh（r 已无 view/全局绑定，fallthrough 后无动作）", () => {
    const deps = makeDeps()
    createAppShellKeyHandler(deps)(key("r"))
    expect(deps.refresh).not.toHaveBeenCalled()
  })

  it("ctrl+r 在 view 返回 true 时被 view 吞（搜索态不 refresh）", () => {
    const viewHandler = vi.fn(() => true)
    const deps = makeDeps({ getViewHandler: () => viewHandler })
    createAppShellKeyHandler(deps)(key("r", { ctrl: true }))
    expect(deps.refresh).not.toHaveBeenCalled()
    expect(viewHandler).toHaveBeenCalledOnce()
  })

  it("ctrl+r 在弹窗打开时不 refresh（弹窗优先吞）", () => {
    const deps = makeDeps({ isOpen: () => true })
    createAppShellKeyHandler(deps)(key("r", { ctrl: true }))
    expect(deps.refresh).not.toHaveBeenCalled()
  })
})

describe("createAppShellKeyHandler — 优先级顺序", () => {
  it("弹窗优先于 view：弹窗打开时 view handler 不被调用", () => {
    const viewHandler = vi.fn(() => true)
    const deps = makeDeps({ isOpen: () => true, getViewHandler: () => viewHandler })
    createAppShellKeyHandler(deps)(key("a", { sequence: "a" }))
    expect(viewHandler).not.toHaveBeenCalled()
  })

  it("弹窗优先于全局：弹窗打开时 1/2/3/ESC 只走 closeTop（ESC）或被吞", () => {
    const deps = makeDeps({ isOpen: () => true })
    const h = createAppShellKeyHandler(deps)
    h(key("1")) // 被吞
    h(key("escape")) // closeTop
    expect(deps.setTab).not.toHaveBeenCalled()
    expect(deps.exit).not.toHaveBeenCalled()
    expect(deps.closeTop).toHaveBeenCalledOnce()
  })

  it("view 优先于全局：view 返回 true 时 ESC 也被 view 吞（搜索态 ESC 退搜索不退出 TUI）", () => {
    const viewHandler = vi.fn(() => true)
    const deps = makeDeps({ getViewHandler: () => viewHandler })
    createAppShellKeyHandler(deps)(key("escape"))
    expect(deps.exit).not.toHaveBeenCalled()
    expect(viewHandler).toHaveBeenCalledOnce()
  })
})

describe("createAppShellKeyHandler — shift+L 语言热切换", () => {
  it("shift+l → toggleLang（key.name 恒小写，大写看 key.shift）", () => {
    const deps = makeDeps()
    createAppShellKeyHandler(deps)(key("l", { shift: true }))
    expect(deps.toggleLang).toHaveBeenCalledOnce()
  })

  it("普通 l（无 shift）→ 不触发 toggleLang（fallthrough 给 view 的 matrix 右移）", () => {
    const deps = makeDeps()
    createAppShellKeyHandler(deps)(key("l"))
    expect(deps.toggleLang).not.toHaveBeenCalled()
  })

  it("shift+l 优先于 view handler：view 不被调用（不被搜索态/matrix 右移拦截）", () => {
    const viewHandler = vi.fn(() => true)
    const deps = makeDeps({ getViewHandler: () => viewHandler })
    createAppShellKeyHandler(deps)(key("l", { shift: true }))
    expect(deps.toggleLang).toHaveBeenCalledOnce()
    expect(viewHandler).not.toHaveBeenCalled()
  })

  it("弹窗打开时 shift+l → 不触发 toggleLang（被弹窗吞，关闭弹窗后再切）", () => {
    const deps = makeDeps({ isOpen: () => true })
    createAppShellKeyHandler(deps)(key("l", { shift: true }))
    expect(deps.toggleLang).not.toHaveBeenCalled()
  })

  it("shift+其他字母不触发 toggleLang（仅 shift+l）", () => {
    const deps = makeDeps()
    createAppShellKeyHandler(deps)(key("a", { shift: true }))
    expect(deps.toggleLang).not.toHaveBeenCalled()
  })
})
