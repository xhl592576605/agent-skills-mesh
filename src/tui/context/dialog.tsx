import { Show, createContext, useContext, batch, type JSX, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog } from "../dialogs/Dialog.js"

/**
 * 弹窗栈（design §7，移植 opencode `src/ui/dialog.tsx` 模式）。
 *
 * store 持有 `{element, onClose}` 列表；`replace` 替换为单条栈顶（opencode 语义），
 * `clear` 整栈关闭并回调每个 onClose，`closeTop` 关闭栈顶（ESC/ctrl+c 用）。
 *
 * 渲染：Provider 内嵌 `<Dialog>`，仅当 stack 非空时显示，内容为栈顶 element。
 *
 * **键位策略**（design §6）：本 Provider 不订阅键盘，ESC/ctrl+c 的"弹窗优先关闭、
 * 否则交给 App"决策集中在 AppShell 的单一 useKeyboard 里，避免多订阅顺序歧义。
 * 弹窗内部组件（如 ConfirmDialog）各自 useKeyboard 监听 return/←/→。
 *
 * **可测性**：栈操作逻辑提取到 `createDialogStore()` 纯工厂（不依赖组件树），
 * 供 `tests/tui/dialog.test.ts` 直接断言 replace/closeTop/clear/isOpen 语义。
 */
export interface DialogStackItem {
  /** 弹窗内容工厂。必须是函数：在 DialogProvider 渲染上下文（owner 正确）调用，
   * 保证内部组件的 useDialog/useTheme 等 context 能解析（避免在事件回调里创建
   * 元素导致 owner 丢失，参考 opencode dialog.tsx）。 */
  element: () => JSX.Element
  onClose?: () => void
}

export interface DialogContextValue {
  /** 替换栈为单个弹窗（opencode 语义，整栈先回调 onClose 再置为新弹窗）。 */
  replace: (element: () => JSX.Element, onClose?: () => void) => void
  /** 关闭栈顶弹窗，回调其 onClose。 */
  closeTop: () => void
  /** 关闭整栈，逐个回调 onClose。 */
  clear: () => void
  /** 弹窗是否打开（供 App 让出全局键）。 */
  isOpen: () => boolean
  /** 当前栈（只读视图）。 */
  stack: () => readonly DialogStackItem[]
}

/**
 * 弹窗栈 store 工厂（design §7，纯逻辑可测）。
 *
 * 返回 `DialogContextValue` 契约 + 额外 `items` 响应式访问器（DialogProvider 渲染
 * 和测试断言共用）。栈操作语义：
 * - `replace(el, onClose)`：先逐个回调旧栈的 onClose，再用 `[el]` 替换整栈
 * - `closeTop()`：回调栈顶 onClose，移除栈顶
 * - `clear()`：batch 内逐个回调 onClose，置空
 * - `isOpen()` / `stack()`：只读视图
 */
export function createDialogStore(): DialogContextValue & {
  readonly items: readonly DialogStackItem[]
} {
  const [stack, setStack] = createStore<DialogStackItem[]>([])

  function closeTop() {
    const top = stack[stack.length - 1]
    top?.onClose?.()
    setStack(stack.slice(0, -1))
  }

  function clear() {
    batch(() => {
      for (const item of stack) item.onClose?.()
      setStack([])
    })
  }

  function replace(element: () => JSX.Element, onClose?: () => void) {
    for (const item of stack) item.onClose?.()
    setStack([{ element, onClose }])
  }

  return {
    replace,
    closeTop,
    clear,
    isOpen: () => stack.length > 0,
    stack: () => stack,
    get items() {
      return stack
    }
  }
}

const DialogContext = createContext<DialogContextValue>()

export function DialogProvider(props: ParentProps) {
  const dialog = createDialogStore()

  return (
    <DialogContext.Provider value={dialog}>
      {props.children}
      <Show when={dialog.items.length > 0}>
        <Dialog size="medium" onClose={dialog.clear}>
          {/* element() 在 DialogProvider owner 上下文调用，内部 useDialog/useTheme 可解析 */}
          {dialog.items[dialog.items.length - 1].element()}
        </Dialog>
      </Show>
    </DialogContext.Provider>
  )
}

export function useDialog(): DialogContextValue {
  const value = useContext(DialogContext)
  if (!value) throw new Error("useDialog must be used within a DialogProvider")
  return value
}
