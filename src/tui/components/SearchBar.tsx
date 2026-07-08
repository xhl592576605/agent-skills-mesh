import type { Theme } from "../theme/index.js"
import { type TranslateFn } from "../context/i18n.js"

export interface SearchBarProps {
  query: string
  active: boolean
  theme: Theme
  t: TranslateFn
}

export function SearchBar(props: SearchBarProps) {
  const theme = props.theme
  return (
    <box
      border={true}
      borderColor={props.active ? theme.borderStrong : theme.border}
      backgroundColor={theme.panel}
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      height={3}
      alignItems="center"
    >
      <text fg={props.active ? theme.primary : theme.textMuted}>⌕  </text>
      <text fg={theme.textMuted}>{props.t("search.label")}</text>
      <text fg={props.active ? theme.text : theme.textMuted} wrapMode="none">
        {props.query || (props.active ? "" : props.t("search.placeholder"))}
      </text>
      <text fg={theme.primary}>{props.active ? "▏" : ""}</text>
      <box flexGrow={1} />
      <text fg={theme.text} bg={theme.keyBg}> / </text>
    </box>
  )
}
