import { describe, it, expect, vi } from "vitest"
import { createDialogStore, type DialogContextValue, type DialogStackItem } from "../../src/tui/context/dialog.js"
import { ConfirmDialog } from "../../src/tui/dialogs/ConfirmDialog.js"
import { SelectDialog } from "../../src/tui/dialogs/SelectDialog.js"
import { PromptDialog } from "../../src/tui/dialogs/PromptDialog.js"

/**
 * 弹窗栈 + 各 show() Promise 语义纯函数测试（design §7，prd A）。
 *
 * **测试策略**：栈操作（replace/closeTop/clear/isOpen）直接调 createDialogStore()
 * 断言 items 状态；各 Dialog.show 的 onClose 路径（ESC/遮罩 → resolve）用 mock dialog
 * 捕获 replace 收到的 onClose 回调并主动触发，断言 Promise resolve 值。
 *
 * **不覆盖**：confirm(true)/cancel(false)/选定值/提交值 路径需 ConfirmDialog 组件实例
 * 的 useKeyboard（return/←→）触发，依赖 opentui owner context（无渲染上下文调 element()
 * 会因 useTheme/useDialog 丢失 owner 抛错）。这部分由 `tests/tui/_bun-smoke*.tsx`
 * 渲染集成测试覆盖（bun runtime native FFI）。
 */

/** 构造无副作用的 element 工厂（不创建真实组件，避免 owner context 依赖）。 */
function el(): DialogStackItem["element"] {
  return () => null as never
}

describe("createDialogStore — 初始状态", () => {
  it("初始栈空、isOpen=false", () => {
    const s = createDialogStore()
    expect(s.isOpen()).toBe(false)
    expect(s.stack()).toHaveLength(0)
    expect(s.items).toHaveLength(0)
  })
})

describe("createDialogStore — replace", () => {
  it("replace 置单弹窗，isOpen=true，items.length=1", () => {
    const s = createDialogStore()
    s.replace(el())
    expect(s.isOpen()).toBe(true)
    expect(s.items).toHaveLength(1)
    expect(s.stack()).toHaveLength(1)
  })

  it("replace 保存 element 工厂与 onClose", () => {
    const s = createDialogStore()
    const element = el()
    const onClose = vi.fn()
    s.replace(element, onClose)
    expect(s.items[0].element).toBe(element)
    expect(s.items[0].onClose).toBe(onClose)
  })

  it("replace 先回调旧栈 onClose（opencode 整栈替换语义）", () => {
    const s = createDialogStore()
    const oldClose = vi.fn()
    s.replace(el(), oldClose)
    s.replace(el())
    expect(oldClose).toHaveBeenCalledOnce()
    expect(s.items).toHaveLength(1)
  })

  it("replace 多次只保留单条栈（不累积）", () => {
    const s = createDialogStore()
    s.replace(el())
    s.replace(el())
    s.replace(el())
    expect(s.items).toHaveLength(1)
  })

  it("replace 无 onClose 不抛", () => {
    const s = createDialogStore()
    expect(() => s.replace(el())).not.toThrow()
  })
})

describe("createDialogStore — push", () => {
  it("push 追加栈顶，不回调旧栈 onClose（叠加子弹窗用）", () => {
    const s = createDialogStore()
    const onCloseBase = vi.fn()
    s.replace(el(), onCloseBase)
    s.push(el())
    expect(s.items).toHaveLength(2)
    expect(onCloseBase).not.toHaveBeenCalled()
  })

  it("closeTop 关栈顶后，下层弹窗重新成为栈顶（不动其 onClose）", () => {
    const s = createDialogStore()
    const onCloseBase = vi.fn()
    const onCloseTop = vi.fn()
    s.replace(el(), onCloseBase)
    s.push(el(), onCloseTop)
    s.closeTop()
    expect(onCloseTop).toHaveBeenCalledOnce()
    expect(onCloseBase).not.toHaveBeenCalled()
    expect(s.items).toHaveLength(1)
  })
})

describe("createDialogStore — closeTop", () => {
  it("closeTop 回调栈顶 onClose 并移除", () => {
    const s = createDialogStore()
    const onClose = vi.fn()
    s.replace(el(), onClose)
    s.closeTop()
    expect(onClose).toHaveBeenCalledOnce()
    expect(s.isOpen()).toBe(false)
    expect(s.items).toHaveLength(0)
  })

  it("closeTop 无弹窗时不抛（空栈安全）", () => {
    const s = createDialogStore()
    expect(() => s.closeTop()).not.toThrow()
    expect(s.isOpen()).toBe(false)
  })

  it("closeTop 无 onClose 的弹窗不抛", () => {
    const s = createDialogStore()
    s.replace(el())
    expect(() => s.closeTop()).not.toThrow()
    expect(s.items).toHaveLength(0)
  })
})

describe("createDialogStore — clear", () => {
  it("clear 逐个回调 onClose 并清空栈", () => {
    const s = createDialogStore()
    const c1 = vi.fn()
    const c2 = vi.fn()
    // replace 是整栈替换，故先 replace 再 replace 不会累积——要测 clear 多条需直接验 clear 语义
    s.replace(el(), c1)
    s.clear()
    expect(c1).toHaveBeenCalledOnce()
    expect(s.isOpen()).toBe(false)
    expect(s.items).toHaveLength(0)
    // 第二次 clear 无副作用
    s.replace(el(), c2)
    s.clear()
    expect(c2).toHaveBeenCalledOnce()
  })

  it("clear 无弹窗时不抛", () => {
    const s = createDialogStore()
    expect(() => s.clear()).not.toThrow()
  })
})

describe("createDialogStore — 组合操作", () => {
  it("replace → closeTop → replace 序列正确", () => {
    const s = createDialogStore()
    const c1 = vi.fn()
    s.replace(el(), c1)
    s.closeTop()
    expect(c1).toHaveBeenCalledOnce()
    expect(s.isOpen()).toBe(false)
    const c2 = vi.fn()
    s.replace(el(), c2)
    expect(s.isOpen()).toBe(true)
    expect(s.items).toHaveLength(1)
  })

  it("clear 后再 replace 正常工作", () => {
    const s = createDialogStore()
    s.replace(el())
    s.clear()
    s.replace(el())
    expect(s.isOpen()).toBe(true)
    expect(s.items).toHaveLength(1)
  })
})

/**
 * mock dialog：捕获 replace 的 (element, onClose)，其余为空实现。
 * 用于测 show() 的 onClose 路径（ESC/遮罩 → resolve）。
 */
function mockDialog(): DialogContextValue & { lastOnClose: (() => void) | undefined; lastElement: (() => unknown) | undefined } {
  let lastOnClose: (() => void) | undefined
  let lastElement: (() => unknown) | undefined
  return {
    replace: (element, onClose) => {
      lastElement = element
      lastOnClose = onClose
    },
    closeTop: () => {
      lastOnClose?.()
    },
    clear: () => {
      lastOnClose?.()
      lastOnClose = undefined
    },
    isOpen: () => lastOnClose !== undefined,
    stack: () => (lastOnClose ? [{ element: lastElement as never, onClose: lastOnClose }] : []),
    get lastOnClose() {
      return lastOnClose
    },
    get lastElement() {
      return lastElement
    }
  }
}

describe("ConfirmDialog.show — Promise 语义", () => {
  it("show() 立即调 dialog.replace 注册 element + onClose", async () => {
    const d = mockDialog()
    const p = ConfirmDialog.show(d, "title", "msg")
    expect(d.lastElement).toBeTypeOf("function")
    expect(d.lastOnClose).toBeTypeOf("function")
    // 未触发前 Promise pending（不 await）
    let resolved = false
    void p.then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
  })

  it("ESC/遮罩路径（onClose）→ resolve(false)", async () => {
    const d = mockDialog()
    const p = ConfirmDialog.show(d, "title", "msg")
    // AppShell ESC → dialog.closeTop → 触发 show 注册的 onClose
    d.lastOnClose?.()
    await expect(p).resolves.toBe(false)
  })

  it("第二次 show 替换栈触发第一次 onClose（真实 store）", async () => {
    // 真实 createDialogStore 的 replace 先回调旧栈 onClose（opencode 语义），
    // 故 p2.show 会触发 p1 的 onClose → p1 resolve(false)；p2 仍 pending。
    const store = createDialogStore()
    const p1 = ConfirmDialog.show(store, "t1", "m1")
    const p2 = ConfirmDialog.show(store, "t2", "m2")
    await expect(p1).resolves.toBe(false)
    // p2 仍 pending（store 里只有 p2 的弹窗）
    let resolved = false
    void p2.then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    expect(store.isOpen()).toBe(true)
  })
})

describe("SelectDialog.show — Promise 语义", () => {
  it("show() 调 replace 注册 element + onClose", () => {
    const d = mockDialog()
    void SelectDialog.show(d, "title", [{ label: "a", value: "a" }])
    expect(d.lastElement).toBeTypeOf("function")
    expect(d.lastOnClose).toBeTypeOf("function")
  })

  it("ESC/遮罩路径 → resolve(undefined)", async () => {
    const d = mockDialog()
    const p = SelectDialog.show(d, "title", [{ label: "a", value: "a" }])
    d.lastOnClose?.()
    await expect(p).resolves.toBeUndefined()
  })

  it("空 options 列表也能正常 show", () => {
    const d = mockDialog()
    expect(() => void SelectDialog.show(d, "title", [])).not.toThrow()
  })
})

describe("PromptDialog.show — Promise 语义", () => {
  it("show() 调 replace 注册 element + onClose", () => {
    const d = mockDialog()
    void PromptDialog.show(d, "title")
    expect(d.lastElement).toBeTypeOf("function")
    expect(d.lastOnClose).toBeTypeOf("function")
  })

  it("ESC/遮罩路径 → resolve(undefined)", async () => {
    const d = mockDialog()
    const p = PromptDialog.show(d, "title", "default", "placeholder")
    d.lastOnClose?.()
    await expect(p).resolves.toBeUndefined()
  })

  it("带 defaultValue / placeholder 参数正常注册", () => {
    const d = mockDialog()
    expect(() => void PromptDialog.show(d, "t", "init", "hint")).not.toThrow()
  })
})

describe("createDialogStore 与真实 show 集成（onClose 路径）", () => {
  it("真实 store + ConfirmDialog.show：closeTop → resolve(false)", async () => {
    const store = createDialogStore()
    const p = ConfirmDialog.show(store, "t", "m")
    expect(store.isOpen()).toBe(true)
    store.closeTop() // 模拟 AppShell 收到 ESC 调 closeTop
    await expect(p).resolves.toBe(false)
    expect(store.isOpen()).toBe(false)
  })

  it("真实 store + SelectDialog.show：clear（遮罩点击）→ resolve(undefined)", async () => {
    const store = createDialogStore()
    const p = SelectDialog.show(store, "t", [{ label: "x", value: "x" }])
    store.clear() // 模拟 Dialog 遮罩点击调 onClose=clear
    await expect(p).resolves.toBeUndefined()
    expect(store.isOpen()).toBe(false)
  })
})
