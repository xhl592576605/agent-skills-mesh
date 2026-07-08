import { For, Show } from "solid-js"
import type { Theme } from "../theme/index.js"

export interface StatusBarProps {
  hints: readonly string[]
  message?: string
  theme: Theme
}

function splitHint(hint: string): { key: string; label: string } {
  const idx = hint.indexOf(" ")
  if (idx < 0) return { key: hint, label: "" }
  return { key: hint.slice(0, idx), label: hint.slice(idx + 1) }
}

/** 底部 keycap 提示栏：保持 hints 契约，只改变展示方式。 */
export function StatusBar(props: StatusBarProps) {
  const theme = props.theme
  return (
    <box
      flexDirection="row"
      backgroundColor={theme.backgroundAlt}
      paddingLeft={1}
      paddingRight={1}
      height={2}
      alignItems="center"
    >
      <For each={props.hints}>
        {(hint) => {
          const pair = () => splitHint(hint)
          return (
            <box flexDirection="row" paddingRight={2}>
              <text fg={theme.text} bg={theme.keyBg}> {pair().key} </text>
              <text fg={theme.textMuted}> {pair().label}</text>
            </box>
          )
        }}
      </For>
      <box flexGrow={1} />
      <Show when={props.message}>
        {(msg: () => string) => <text fg={theme.textMuted}>{msg()}</text>}
      </Show>
    </box>
  )
}
