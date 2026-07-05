import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import type { ParentProps } from "solid-js"
import { createSignal } from "solid-js"
import { useTheme } from "../context/theme.js"
import { useDialog, type DialogContextValue } from "../context/dialog.js"

/**
 * 单行输入弹窗（design §7，参考 opencode `dialog-prompt.tsx` 模式但简化）。
 *
 * **不使用 `<input>` 组件**：opencode 用 InputRenderable + ref.focus()，但 focus 在弹窗
 * 场景下有 owner context 丢失风险（skill pitfall）。改为 `useKeyboard` 字符收集
 * （与 SkillAgentView 搜索态同款），键路由清晰、测试友好。
 *
 * 用法（异步模式）：
 * ```ts
 * const target = await PromptDialog.show(dialog, "Add source", "", "url or path")
 * if (target) await addSource(...)
 * ```
 *
 * 键位：可打印 ASCII 追加、`backspace` 删尾、`return` 提交、`esc`/ctrl+c/遮罩点击由
 * DialogProvider 统一关闭 → onClose → resolve(undefined)。
 */
export interface PromptDialogProps {
  title: string
  /** 默认值。 */
  defaultValue?: string
  /** 占位提示（value 为空时显示）。 */
  placeholder?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function PromptDialog(props: ParentProps<PromptDialogProps>) {
  const theme = useTheme()
  const dialog = useDialog()
  const [value, setValue] = createSignal(props.defaultValue ?? "")

  useKeyboard((key) => {
    if (key.name === "return") {
      const v = value()
      dialog.clear()
      props.onConfirm(v)
      return
    }
    if (key.name === "backspace") {
      setValue((v) => v.slice(0, -1))
      return
    }
    // ESC / ctrl+c 由 AppShell 关弹窗 → onClose → resolve(undefined)，本组件不重复处理。
    if (key.name === "escape" || (key.ctrl && key.name === "c")) return
    const ch = key.sequence
    if (ch && ch.length === 1 && /[\x20-\x7e]/.test(ch)) {
      setValue((v) => v + ch)
    }
  })

  const display = () => value() || (props.placeholder ?? "")

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      {/* 输入行：value（空时占位灰）+ block cursor。空 value 用 placeholder 灰显示。 */}
      <box height={1} backgroundColor={theme.background}>
        <text fg={value() ? theme.text : theme.textMuted}>{display()}</text>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          _
        </text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>return confirm · backspace delete · esc cancel</text>
      </box>
    </box>
  )
}

/**
 * 弹出输入弹窗，返回用户输入。
 * - 非空字符串：用户按 return 提交
 * - `undefined`：用户 ESC / ctrl+c / 遮罩点击关闭（onClose）
 *
 * 注意：空字符串提交（return 不输入任何字符）也会 resolve("")，调用侧需自行判断是否接受空值。
 */
export namespace PromptDialog {
  export function show(
    dialog: DialogContextValue,
    title: string,
    defaultValue?: string,
    placeholder?: string
  ): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      const element = () => (
        <PromptDialog
          title={title}
          defaultValue={defaultValue}
          placeholder={placeholder}
          onConfirm={(v) => resolve(v)}
          onCancel={() => resolve(undefined)}
        />
      )
      dialog.replace(element, () => resolve(undefined))
    })
  }
}
