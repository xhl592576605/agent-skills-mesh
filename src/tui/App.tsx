import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { Show, createMemo, createSignal } from "solid-js"
import { ThemeProvider, useTheme } from "./context/theme.js"
import { DataProvider, useData } from "./context/data.js"
import { I18nProvider, useI18n } from "./context/i18n.js"
import { DialogProvider, useDialog } from "./context/dialog.js"
import { ViewKeyProvider, type ViewKeyContextValue, type ViewKeyHandler } from "./context/view-key.js"
import { StatusBar } from "./components/StatusBar.js"
import { AppHeader } from "./components/AppHeader.js"
import { TabBar } from "./components/TabBar.js"
import { SkillAgentView } from "./views/SkillAgentView.js"
import { SourceView } from "./views/SourceView.js"
import { DoctorView } from "./views/DoctorView.js"
import { createAppShellKeyHandler } from "./state/app-keys.js"
import { tabHintKeys, type AppTab } from "./state/tab-hints.js"
import type { Locale } from "../i18n/index.js"

/**
 * App —— Provider 装配 + 布局入口。
 *
 * 结构：ThemeProvider → I18nProvider → DataProvider → DialogProvider → AppShell。
 * I18nProvider 位于 DialogProvider 之外，故弹窗内的 `useI18n()` 也能解析（弹窗 element
 * 在 DialogProvider owner 内创建，被 I18nContext 覆盖）。`lang` 由 `run()` 经
 * `resolveLanguage()` 解析后注入，TUI 内 `shift+L` 热切换只改 signal + 写回 config。
 */
export function App(props: { lang: Locale }) {
  return (
    <ThemeProvider>
      <I18nProvider initial={props.lang}>
        <DataProvider>
          <DialogProvider>
            <AppShell />
          </DialogProvider>
        </DataProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}

function AppShell() {
  const theme = useTheme()
  const i18n = useI18n()
  const dialog = useDialog()
  const data = useData()
  const renderer = useRenderer()
  const dim = useTerminalDimensions()
  const [tab, setTab] = createSignal<AppTab>("skill")

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

  /** Tab 标签（依赖 t()，语言切换后响应式重算）。 */
  const tabs = createMemo(() => [
    { key: "skill" as const, label: i18n.t("tab.skill") },
    { key: "source" as const, label: i18n.t("tab.source") },
    { key: "doctor" as const, label: i18n.t("tab.doctor") }
  ])

  /** 当前 tab 的快捷键提示（注入 StatusBar）。依赖 t()，语言切换后响应式。 */
  const tabHints = createMemo((): readonly string[] =>
    tabHintKeys(tab()).map((key) => i18n.t(key))
  )

  /**
   * 单一 useKeyboard 集中路由（design §6）。opentui useKeyboard 无 stopPropagation，
   * 多订阅会双触发，故 AppShell 唯一订阅，把派发逻辑交给纯函数 `createAppShellKeyHandler`
   * （见 state/app-keys.ts，便于 tests/tui/key-routing.test.ts 纯函数测试）。
   *
   * 派发优先级：①弹窗打开→ESC/ctrl+c 关栈顶，其余键交弹窗内部组件；②shift+L 语言热切换
   * （全局）；③view handler 优先消费（返回 true=吞）；④全局键（1/2/3 tab、ctrl+r refresh、
   * ? help、ESC/ctrl+c 退出）。exitOnCtrlC=false（index.tsx），ctrl+c 全由此处理。
   */
  useKeyboard(
    createAppShellKeyHandler({
      isOpen: dialog.isOpen,
      closeTop: dialog.closeTop,
      getViewHandler: () => viewHandler,
      setTab,
      cycleTab: () => {
        const order: AppTab[] = ["skill", "source", "doctor"]
        const i = order.indexOf(tab())
        setTab(order[(i + 1) % order.length])
      },
      refresh: () => void data.refresh(),
      showHelp,
      exit: exitTui,
      toggleLang: () => void i18n.toggle()
    })
  )

  /** `?` 全局帮助：弹只读键位表，ESC 由 AppShell 关弹窗。 */
  function showHelp(): void {
    dialog.replace(() => (
      <box flexDirection="column" gap={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {i18n.t("help.title")}
          </text>
          <text fg={theme.textMuted}>{i18n.t("help.esc")}</text>
        </box>
        <text fg={theme.accent}>{i18n.t("help.globalSection")}</text>
        <text fg={theme.textMuted}>{i18n.t("help.globalLine")}</text>
        <text fg={theme.accent}>{i18n.t("help.skillSection")}</text>
        <text fg={theme.textMuted}>{i18n.t("help.skillLine")}</text>
        <text fg={theme.accent}>{i18n.t("help.sourceSection")}</text>
        <text fg={theme.textMuted}>{i18n.t("help.sourceLine")}</text>
        <text fg={theme.accent}>{i18n.t("help.doctorSection")}</text>
        <text fg={theme.textMuted}>{i18n.t("help.doctorLine")}</text>
        <text fg={theme.textMuted}>{i18n.t("help.close")}</text>
      </box>
    ))
  }

  const statusMessage = createMemo(() => {
    if (data.snapshot.loading) return i18n.t("common.loadingShort")
    if (data.snapshot.error) return i18n.t("common.errorShort")
    return undefined
  })

  const summary = createMemo(() => {
    const index = data.snapshot.index
    const state = data.snapshot.state
    const total = state ? Object.keys(state.installedSkills).length : Object.keys(index?.skills ?? {}).length
    const issues = index?.issues ?? []
    const errors = issues.filter((issue) => issue.severity === "error").length
    const warnings = issues.filter((issue) => issue.severity === "warning").length
    return { total, errors, warnings }
  })

  return (
    <ViewKeyProvider value={viewKeyCtx}>
      <box
        width={dim().width}
        height={dim().height}
        flexDirection="column"
        backgroundColor={theme.background}
      >
        <AppHeader
          summary={summary()}
          theme={theme}
          totalLabel={i18n.t("header.total")}
          errorLabel={i18n.t("header.errors")}
          warningLabel={i18n.t("header.warnings")}
          okLabel={i18n.t("header.ok")}
        />
        <TabBar tabs={tabs()} active={tab()} theme={theme} />

        {/* 内容视图（design §13：数据驱动 Show 切换，新增 tab 不改结构） */}
        <box flexGrow={1} paddingLeft={1} paddingRight={1} paddingTop={1}>
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
        <StatusBar hints={tabHints()} message={statusMessage()} theme={theme} />
      </box>
    </ViewKeyProvider>
  )
}
