import { For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { Theme } from "../theme/index.js"

export interface TabItem<T extends string> {
  key: T
  label: string
}

export interface TabBarProps<T extends string> {
  tabs: readonly TabItem<T>[]
  active: T
  theme: Theme
}

function displayWidth(value: string): number {
  let width = 0
  for (const char of value) {
    width += char.charCodeAt(0) > 0xff ? 2 : 1
  }
  return width
}

export function TabBar<T extends string>(props: TabBarProps<T>) {
  const theme = props.theme
  return (
    <box flexDirection="column" backgroundColor={theme.panelMuted}>
      <box flexDirection="row" height={2} paddingLeft={2}>
        <For each={props.tabs}>
          {(tab) => {
            const active = () => props.active === tab.key
            const label = () => `[${tab.label}]`
            const width = () => Math.max(14, displayWidth(label()) + 6)
            return (
              <box flexDirection="column" width={width()} paddingRight={1}>
                <box
                  height={1}
                  paddingLeft={2}
                  paddingRight={2}
                  backgroundColor={active() ? theme.selection : theme.panelMuted}
                >
                  <text
                    fg={active() ? theme.primary : theme.textMuted}
                    attributes={active() ? TextAttributes.BOLD : undefined}
                  >
                    {label()}
                  </text>
                </box>
                <box height={1} paddingLeft={2} paddingRight={2}>
                  <text fg={active() ? theme.primary : theme.panelMuted} wrapMode="none">
                    {"━".repeat(Math.max(1, width() - 5))}
                  </text>
                </box>
              </box>
            )
          }}
        </For>
      </box>
      <box height={1} backgroundColor={theme.border} />
    </box>
  )
}
