import { createContext, useContext, type ParentProps } from "solid-js"
import { theme as defaultTheme, type Theme } from "../theme/index.js"

/**
 * ThemeProvider —— 注入主题；未提供时用默认 `theme`（design §8）。
 *
 * 用 Solid Context 同构 Provider/use 模式（design §4）。组件经 `useTheme()`
 * 读取当前主题，避免硬编码颜色。
 */
const ThemeContext = createContext<Theme>(defaultTheme)

export function ThemeProvider(props: ParentProps<{ theme?: Theme }>) {
  return (
    <ThemeContext.Provider value={props.theme ?? defaultTheme}>
      {props.children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): Theme {
  const value = useContext(ThemeContext)
  return value ?? defaultTheme
}
