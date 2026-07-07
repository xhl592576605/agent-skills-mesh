import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { For, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme.js"
import { useI18n } from "../context/i18n.js"
import { useDialog, type DialogContextValue } from "../context/dialog.js"

/**
 * 确认弹窗（design §7，参考 opencode `dialog-confirm.tsx`）。
 *
 * 用法（异步确认模式）：
 * ```ts
 * const ok = await ConfirmDialog.show(dialog, "Remove source?", "...")
 * if (ok) await removeSource(...)
 * ```
 *
 * 键位：`←`/`→` 切换 cancel/confirm，`return` 触发当前选项。
 * ESC / ctrl+c / 遮罩点击由 DialogProvider 统一处理 → onClose → resolve(false)。
 */
export interface ConfirmDialogProps {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
  confirmLabel?: string
  cancelLabel?: string
}

export function ConfirmDialog(props: ParentProps<ConfirmDialogProps>) {
  const theme = useTheme()
  const i18n = useI18n()
  const dialog = useDialog()
  const [sel, setSel] = createStore<{ active: "confirm" | "cancel" }>({ active: "confirm" })

  function commit() {
    if (sel.active === "confirm") props.onConfirm?.()
    else props.onCancel?.()
    dialog.clear()
  }

  useKeyboard((key) => {
    if (key.name === "left" || key.name === "right") {
      setSel("active", sel.active === "confirm" ? "cancel" : "confirm")
    } else if (key.name === "return") {
      commit()
    }
  })

  // 渲染顺序：cancel 在左、confirm 在右（与 opencode 一致，回车默认 confirm）。
  const optionList = () => [
    { key: "cancel" as const, label: props.cancelLabel ?? i18n.t("btn.cancel") },
    { key: "confirm" as const, label: props.confirmLabel ?? i18n.t("btn.confirm") }
  ]

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>{props.message}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" gap={1}>
        <For each={optionList()}>
          {(opt) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={opt.key === sel.active ? theme.primary : undefined}
              onMouseUp={() => {
                setSel("active", opt.key)
                commit()
              }}
            >
              <text fg={opt.key === sel.active ? theme.backgroundPanel : theme.textMuted}>{opt.label}</text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

/**
 * 弹出确认弹窗，返回用户选择（声明合并：`ConfirmDialog.show`）。
 * - `true`：用户选 confirm（return 或点击 confirm 按钮）
 * - `false`：用户选 cancel，或 ESC / ctrl+c / 遮罩点击关闭（onClose）
 *
 * onClose 视为取消（resolve(false)），符合 Promise<boolean> 契约（prd AC）。
 */
export namespace ConfirmDialog {
  export function show(
    dialog: DialogContextValue,
    title: string,
    message: string,
    options?: { confirmLabel?: string; cancelLabel?: string }
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const element = () => (
        <ConfirmDialog
          title={title}
          message={message}
          confirmLabel={options?.confirmLabel}
          cancelLabel={options?.cancelLabel}
          onConfirm={() => resolve(true)}
          onCancel={() => resolve(false)}
        />
      )
      dialog.replace(element, () => resolve(false))
    })
  }
}
