import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { Show, createMemo, createSignal } from "solid-js"
import { ThemeProvider, useTheme } from "./context/theme.js"
import { DataProvider, useData } from "./context/data.js"
import { DialogProvider, useDialog } from "./context/dialog.js"
import { ViewKeyProvider, type ViewKeyContextValue, type ViewKeyHandler } from "./context/view-key.js"
import { StatusBar } from "./components/StatusBar.js"
import { SkillAgentView } from "./views/SkillAgentView.js"
import { SourceView } from "./views/SourceView.js"
import { DoctorView } from "./views/DoctorView.js"
import { createAppShellKeyHandler } from "./state/app-keys.js"

type Tab = "skill" | "source" | "doctor"

/** 顶部 TabBar 三个 tab（design §13：数据驱动，新增 tab 不改 App 结构）。 */
const TABS: { key: Tab; label: string }[] = [
  { key: "skill", label: "1 Skill×Agent" },
  { key: "source", label: "2 Source" },
  { key: "doctor", label: "3 Doctor" }
]

/** 各 tab 的快捷键提示（注入 StatusBar，design §13 契约）。child-3 扩展 source/doctor。 */
const TAB_HINTS: Record<Tab, readonly string[]> = {
  // a=行全装、d=行全卸（对称命名，避免「d none」被误解为清空）；ctrl+r=全局刷新。
  skill: [
    "↑↓←→ move",
    "enter toggle",
    "a row-on",
    "d row-off",
    "r review",
    "/ search",
    "ctrl+r refresh",
    "? help",
    "1/2/3 tabs"
  ],
  source: [
    "↑↓ move",
    "a add",
    "u update",
    "d remove",
    "e/x en/dis",
    "enter detail",
    "ctrl+r refresh",
    "? help",
    "1/2/3 tabs"
  ],
  doctor: [
    "↑↓ move",
    "f fix",
    "F fix-all",
    "ctrl+r refresh",
    "? help",
    "1/2/3 tabs"
  ]
}

/**
 * App —— Provider 装配 + 布局入口。
 *
 * 结构：ThemeProvider → DataProvider → DialogProvider → AppShell。
 * AppShell 负责 TabBar / 内容视图 / StatusBar + **集中键盘路由**（design §6）。
 */
export function App() {
  return (
    <ThemeProvider>
      <DataProvider>
        <DialogProvider>
          <AppShell />
        </DialogProvider>
      </DataProvider>
    </ThemeProvider>
  )
}

function AppShell() {
  const theme = useTheme()
  const dialog = useDialog()
  const data = useData()
  const renderer = useRenderer()
  const dim = useTerminalDimensions()
  const [tab, setTab] = createSignal<Tab>("skill")

  function exitTui() {
    renderer.destroy()
    process.exit(0)
  }

  // View 注册的按键 handler（null=未注册/非交互 tab）。用普通变量持有：
  // useKeyboard 回调每次按键读取最新引用，无需响应式（避免无谓重渲染）。
  let viewHandler: ViewKeyHandler | null = null
  const setHandler = (h: ViewKeyHandler | null) => {
    viewHandler = h
  }
  const viewKeyCtx: ViewKeyContextValue = { setHandler }

  /**
   * 单一 useKeyboard 集中路由（design §6）。opentui useKeyboard 无 stopPropagation，
   * 多订阅会双触发，故 AppShell 唯一订阅，把派发逻辑交给纯函数 `createAppShellKeyHandler`
   * （见 state/app-keys.ts，便于 tests/tui/key-routing.test.ts 纯函数测试）。
   *
   * 派发优先级：①弹窗打开→ESC/ctrl+c 关栈顶，其余键交弹窗内部组件；②view handler 优先
   * 消费（返回 true=吞，如搜索态吞字符、Matrix 操作键）；③全局键（1/2/3 tab、ctrl+r
   * refresh、? help、ESC/ctrl+c 退出）。exitOnCtrlC=false（index.tsx），ctrl+c 全由此处理。
   */
  useKeyboard(
    createAppShellKeyHandler({
      isOpen: dialog.isOpen,
      closeTop: dialog.closeTop,
      getViewHandler: () => viewHandler,
      setTab,
      refresh: () => void data.refresh(),
      showHelp,
      exit: exitTui
    })
  )

  /** `?` 全局帮助：弹只读键位表，ESC 由 AppShell 关弹窗。 */
  function showHelp(): void {
    dialog.replace(() => (
      <box flexDirection="column" gap={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Keybindings
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>
        <text fg={theme.accent}>global</text>
        <text fg={theme.textMuted}>1/2/3 tabs · ctrl+r refresh · ? help · esc/ctrl+c exit</text>
        <text fg={theme.accent}>skill×agent</text>
        <text fg={theme.textMuted}>{"↑↓←→/hjkl move · enter toggle · a row-on · d row-off · r review · / search"}</text>
        <text fg={theme.accent}>source</text>
        <text fg={theme.textMuted}>{"a add · u update · d remove · e/x enable/disable · enter detail"}</text>
        <text fg={theme.accent}>doctor</text>
        <text fg={theme.textMuted}>f fix selected · F fix all · ↑↓ move</text>
        <text fg={theme.textMuted}>esc to close</text>
      </box>
    ))
  }

  const statusMessage = createMemo(() => {
    if (data.snapshot.loading) return "loading"
    if (data.snapshot.error) return "error"
    return undefined
  })

  return (
    <ViewKeyProvider value={viewKeyCtx}>
      <box
        width={dim().width}
        height={dim().height}
        flexDirection="column"
        backgroundColor={theme.background}
      >
        {/* TabBar（静态常量，map 一次即可；tab() 在 JSX getter 里响应式） */}
        <box flexDirection="row" backgroundColor={theme.backgroundPanel} paddingLeft={1} paddingRight={1}>
          {TABS.map((t) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={tab() === t.key ? theme.primary : undefined}
            >
              <text fg={tab() === t.key ? theme.backgroundPanel : theme.textMuted}>
                [{t.label}]
              </text>
            </box>
          ))}
        </box>

        {/* 内容视图（design §13：数据驱动 Show 切换，新增 tab 不改结构） */}
        <box flexGrow={1}>
          <Show when={tab() === "skill"}>
            <SkillAgentView />
          </Show>
          <Show when={tab() === "source"}>
            <SourceView />
          </Show>
          <Show when={tab() === "doctor"}>
            <DoctorView />
          </Show>
        </box>

        {/* StatusBar（design §13 契约：接受 hints，child-3 扩展） */}
        <StatusBar hints={TAB_HINTS[tab()]} message={statusMessage()} theme={theme} />
      </box>
    </ViewKeyProvider>
  )
}

