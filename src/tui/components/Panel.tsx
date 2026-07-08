import type { JSX } from "solid-js"
import type { Theme } from "../theme/index.js"

export interface PanelProps {
  title?: string
  theme: Theme
  height?: number
  flexGrow?: number
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
  children: JSX.Element
}

/** 通用深色边框面板：只负责视觉容器，不承载业务状态。 */
export function Panel(props: PanelProps) {
  const theme = props.theme
  return (
    <box
      border={true}
      borderColor={theme.border}
      backgroundColor={theme.panel}
      flexDirection="column"
      height={props.height}
      flexGrow={props.flexGrow}
      paddingLeft={props.paddingLeft ?? 0}
      paddingRight={props.paddingRight ?? 0}
      paddingTop={props.paddingTop ?? 0}
      paddingBottom={props.paddingBottom ?? 0}
    >
      {props.title ? (
        <box height={1} paddingLeft={1} backgroundColor={theme.panelMuted}>
          <text fg={theme.textMuted}>{props.title}</text>
        </box>
      ) : undefined}
      {props.children}
    </box>
  )
}
