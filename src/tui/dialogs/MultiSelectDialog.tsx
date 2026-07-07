import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { For, createEffect, createSignal, type ParentProps } from "solid-js"
import { useTheme } from "../context/theme.js"
import { useI18n } from "../context/i18n.js"
import { useDialog, type DialogContextValue } from "../context/dialog.js"

/**
 * 多选列表弹窗（task 07-06-cli-tui-bugfix · R4）。
 *
 * 用于 Source 详情：标记已 add（locked `[✓]`）、`space` 勾选未 add、`i` 查看单个 SKILL.md、
 * `return` 批量确认、esc 取消。结构与 SelectDialog 同款（Dialog base + useKeyboard + show() helper）。
 *
 * 键位：`↑↓`/`kj` 移动、`space` 切换勾选（locked 跳过）、`i` 触发 onInspect（不关闭）、
 * `return` 提交已勾选、`esc`/ctrl+c/遮罩点击由 DialogProvider 关闭 → onCancel → resolve(undefined)。
 */
export interface MultiSelectOption<T = string> {
  label: string
  value: T
  description?: string
  /** 初始勾选态。 */
  checked?: boolean
  /** 锁定（已 installed）：不可勾选，前缀 `[✓]`。 */
  locked?: boolean
}

export interface MultiSelectDialogProps<T> {
  title: string
  options: MultiSelectOption<T>[]
  onConfirm: (selected: T[]) => void
  onCancel: () => void
  /** `i`：查看当前项 SKILL.md（不关闭本弹窗，由调用侧弹 SkillMdDialog）。 */
  onInspect?: (value: T) => void
}

export function MultiSelectDialog<T>(props: ParentProps<MultiSelectDialogProps<T>>) {
  const theme = useTheme()
  const i18n = useI18n()
  const dialog = useDialog()
  const [sel, setSel] = createSignal(0)
  const [checked, setChecked] = createSignal<Set<number>>(new Set())

  // 初始勾选：options.checked（排除 locked）。options 不变时仅运行一次。
  createEffect(() => {
    const init = new Set<number>()
    props.options.forEach((opt, i) => {
      if (opt.checked && !opt.locked) init.add(i)
    })
    setChecked(init)
  })

  function move(delta: number): void {
    const opts = props.options
    if (opts.length === 0) return
    const n = opts.length
    let next = sel() + delta
    if (next < 0) next = n - 1
    else if (next >= n) next = 0
    setSel(next)
  }

  function toggle(i: number): void {
    const opt = props.options[i]
    if (!opt || opt.locked) return
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  useKeyboard((key) => {
    if (key.name === "up" || key.name === "k") {
      move(-1)
      return
    }
    if (key.name === "down" || key.name === "j") {
      move(1)
      return
    }
    if (key.name === "space" || key.sequence === " ") {
      toggle(sel())
      return
    }
    if (key.name === "return") {
      const selected = [...checked()].sort((a, b) => a - b).map((i) => props.options[i].value)
      // 顺序关键：onConfirm 先 resolve(selected)，再 dialog.clear()。clear() 会同步触发
      // onClose→resolve(undefined)，若 clear 先则选中值被丢弃（Promise 只 settle 一次）。
      props.onConfirm(selected)
      dialog.clear()
      return
    }
    if (key.name === "i" && props.onInspect) {
      const opt = props.options[sel()]
      if (opt) props.onInspect(opt.value)
      return
    }
    // ESC / ctrl+c 由 AppShell 关弹窗 → onClose → onCancel。
  })

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box flexDirection="column">
        <For each={props.options}>
          {(opt, i) => {
            const prefix = () => (opt.locked ? "[✓]" : checked().has(i()) ? "[x]" : "[ ]")
            return (
              <box
                flexDirection="row"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={i() === sel() ? theme.primary : undefined}
              >
                <text fg={i() === sel() ? theme.backgroundPanel : opt.locked ? theme.textMuted : theme.text}>
                  {i() === sel() ? "❯" : " "} {prefix()} {opt.label}
                  {opt.description ? `  ${opt.description}` : ""}
                </text>
              </box>
            )
          }}
        </For>
      </box>
      <text fg={theme.textMuted}>{i18n.t("multiSelect.footer")}</text>
    </box>
  )
}

export namespace MultiSelectDialog {
  /**
   * 弹出多选列表。
   * - `T[]`：return 提交的勾选项（可能为空数组）
   * - `undefined`：esc/ctrl+c/遮罩关闭
   * - `onInspect`：按 `i` 时触发（不关闭，由调用侧弹 SKILL.md）
   */
  export function show<T>(
    dialog: DialogContextValue,
    title: string,
    options: MultiSelectOption<T>[],
    opts?: { onInspect?: (value: T) => void }
  ): Promise<T[] | undefined> {
    return new Promise<T[] | undefined>((resolve) => {
      const element = () => (
        <MultiSelectDialog
          title={title}
          options={options}
          onConfirm={(selected) => resolve(selected)}
          onCancel={() => resolve(undefined)}
          onInspect={opts?.onInspect}
        />
      )
      dialog.replace(element, () => resolve(undefined))
    })
  }
}
