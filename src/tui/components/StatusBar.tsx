import { Show } from "solid-js"
import type { Theme } from "../theme/index.js"

/**
 * 底部状态栏（design §13 契约）。
 *
 * **必须接受 `hints` prop**（当前 tab 注入快捷键提示数组）。child-3 的 Source/Doctor tab
 * 会传入各自 hints 而不改本组件结构。`message` 为右侧可选状态文本（loading/error/pending 提示）。
 */
export interface StatusBarProps {
  hints: readonly string[]
  message?: string
  theme: Theme
}

export function StatusBar(props: StatusBarProps) {
  const theme = props.theme
  return (
    <box
      flexDirection="row"
      backgroundColor={theme.backgroundPanel}
      paddingLeft={1}
      paddingRight={1}
      height={1}
    >
      <text fg={theme.textMuted}>{props.hints.join(" · ")}</text>
      <box flexGrow={1} />
      <Show when={props.message}>
        {(msg: () => string) => <text fg={theme.textMuted}>{msg()}</text>}
      </Show>
    </box>
  )
}
