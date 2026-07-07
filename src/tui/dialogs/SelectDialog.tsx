import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { For, createEffect, createSignal, type ParentProps } from "solid-js"
import { useTheme } from "../context/theme.js"
import { useI18n } from "../context/i18n.js"
import { useDialog, type DialogContextValue } from "../context/dialog.js"

/**
 * 列表选择弹窗（design §7，参考 opencode `dialog-select.tsx` 模式但简化）。
 *
 * 用途：source 选择（skill add 多来源、skill rebind）、purge 选项、source type 选择等。
 *
 * 用法：
 * ```ts
 * const src = await SelectDialog.show(dialog, "Select source", sources.map(s => ({label: s.id, value: s.id})))
 * if (src) await skillAdd(..., {source: src})
 * ```
 *
 * 键位：`↑↓`/`kj` 移动、`return` 选定、`esc`/ctrl+c/遮罩点击由 DialogProvider 关闭 → resolve(undefined)。
 */
export interface SelectOption<T = string> {
  label: string
  value: T
  /** 可选副标题（灰色）。 */
  description?: string
  /** 不可选（置灰、跳过）。 */
  disabled?: boolean
}

export interface SelectDialogProps<T> {
  title: string
  options: SelectOption<T>[]
  onConfirm: (value: T) => void
  onCancel: () => void
}

export function SelectDialog<T>(props: ParentProps<SelectDialogProps<T>>) {
  const theme = useTheme()
  const i18n = useI18n()
  const dialog = useDialog()
  const [sel, setSel] = createSignal(0)

  // options 变化（或初始）时 clamp sel 到可选范围（跳过 disabled，落点首个 enabled）。
  createEffect(() => {
    const opts = props.options
    if (opts.length === 0) {
      setSel(0)
      return
    }
    const max = opts.length - 1
    let next = Math.min(max, Math.max(0, sel()))
    if (opts[next]?.disabled) {
      // 当前落点是 disabled，找最近的 enabled。
      const enabled = opts.findIndex((o) => !o.disabled)
      next = enabled >= 0 ? enabled : 0
    }
    setSel(next)
  })

  function move(delta: number) {
    const opts = props.options
    if (opts.length === 0) return
    const n = opts.length
    let next = sel() + delta
    // 循环 + 跳过 disabled。
    for (let i = 0; i < n; i++) {
      if (next < 0) next = n - 1
      else if (next >= n) next = 0
      if (!opts[next]?.disabled) break
      next += delta > 0 ? 1 : -1
    }
    setSel(next)
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
    if (key.name === "return") {
      const opt = props.options[sel()]
      if (!opt || opt.disabled) return
      const value = opt.value
      // onConfirm 先 resolve(value)，再 dialog.clear()（clear 的 onClose 会 resolve(undefined)，
      // 但 Promise 已 settle 故丢弃；clear 先会导致选中值丢失）。
      props.onConfirm(value)
      dialog.clear()
    }
    // ESC / ctrl+c 由 AppShell 关弹窗。
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
          {(opt, i) => (
            <box
              flexDirection="row"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={i() === sel() ? theme.primary : undefined}
            >
              <text fg={i() === sel() ? theme.backgroundPanel : opt.disabled ? theme.textMuted : theme.text}>
                {i() === sel() ? "❯" : " "} {opt.label}
                {opt.description ? `  ${opt.description}` : ""}
              </text>
            </box>
          )}
        </For>
      </box>
      <text fg={theme.textMuted}>{i18n.t("select.footer")}</text>
    </box>
  )
}

/**
 * 弹出列表选择，返回选定值。
 * - 非空值：用户按 return 选定
 * - `undefined`：用户 ESC / ctrl+c / 遮罩点击关闭（onClose）
 */
export namespace SelectDialog {
  export function show<T>(
    dialog: DialogContextValue,
    title: string,
    options: SelectOption<T>[]
  ): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve) => {
      const element = () => (
        <SelectDialog
          title={title}
          options={options}
          onConfirm={(v) => resolve(v)}
          onCancel={() => resolve(undefined)}
        />
      )
      dialog.replace(element, () => resolve(undefined))
    })
  }
}
