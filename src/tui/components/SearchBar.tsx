import type { Theme } from "../theme/index.js"

/**
 * 搜索栏（design §6 `/` 触发）。
 *
 * 纯展示组件：`query` / `active` 由父级 SearchState 控制，键盘输入在 SkillAgentView 的
 * 单一 useKeyboard 里处理（active 时收字符）。active 时加边框高亮，并显示输入光标 `▏`。
 */
export interface SearchBarProps {
  query: string
  active: boolean
  theme: Theme
}

export function SearchBar(props: SearchBarProps) {
  const theme = props.theme
  return (
    <box
      border={props.active}
      borderColor={props.active ? theme.primary : theme.backgroundPanel}
      flexDirection="row"
      paddingLeft={1}
      height={3}
    >
      <text fg={theme.textMuted}>search: </text>
      <text fg={props.active ? theme.text : theme.textMuted}>
        {props.query || (props.active ? "" : "(press / to filter skills)")}
      </text>
      <text fg={theme.primary}>{props.active ? "▏" : ""}</text>
    </box>
  )
}
