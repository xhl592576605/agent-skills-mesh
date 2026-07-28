import { PasteEvent, TextAttributes } from "@opentui/core"
import { useKeyboard, usePaste } from "@opentui/solid"
import { For, Show, createSignal, onCleanup } from "solid-js"
import { useTheme } from "../context/theme.js"
import { useI18n } from "../context/i18n.js"
import { useDialog, type DialogContextValue } from "../context/dialog.js"
import { useData } from "../context/data.js"
import {
  SKILLS_SH_SEARCH_LIMIT,
  searchSkillsSh,
  type SkillsShSkillRef,
} from "../../core/services/skills-sh-service.js"
import {
  buildSkillsShDetailUrls,
  createSkillsShSearchState,
  nextSkillsShDetailLink,
  type SkillsShDetailLink,
} from "../state/skills-sh-search.js"
import { errorMessage } from "../../i18n/index.js"
import { openExternalUrl } from "../../utils/system-actions.js"

/** skills.sh 实时搜索、外部详情链接与单选安装弹窗。 */
export interface SkillsShSearchDialogProps {
  onInstall: (ref: SkillsShSkillRef) => Promise<SkillsShInstallOutcome>
}

export interface SkillsShInstallOutcome {
  outcome: "installed" | "conflict" | "failed"
  message: string
}

const NAME_COL = 34
const SOURCE_COL = 28

type LinkActionState = {
  kind: "loading" | "success" | "error"
  text: string
}

function fit(s: string, width: number): string {
  if (s.length > width) return s.slice(0, Math.max(1, width - 1)) + "…"
  return s.padEnd(width)
}

export function SkillsShSearchDialog(props: SkillsShSearchDialogProps) {
  const theme = useTheme()
  const i18n = useI18n()
  const dialog = useDialog()
  const data = useData()

  const isInstalled = (skillId: string): boolean =>
    Boolean(data.snapshot.state?.installedSkills[skillId])
  const searchState = createSkillsShSearchState({ search: searchSkillsSh, isInstalled })

  const [detailMode, setDetailMode] = createSignal(false)
  const [detailRef, setDetailRef] = createSignal<SkillsShSkillRef | null>(null)
  const [selectedLink, setSelectedLink] = createSignal<SkillsShDetailLink>("skillsSh")
  const [installing, setInstalling] = createSignal(false)
  const [linkActionBusy, setLinkActionBusy] = createSignal(false)
  const [linkAction, setLinkAction] = createSignal<LinkActionState | null>(null)
  const [resultMessage, setResultMessage] = createSignal("")
  let linkActionId = 0
  let disposed = false

  onCleanup(() => {
    disposed = true
    linkActionId++
    searchState.dispose()
  })

  function returnToList(message = ""): void {
    linkActionId++
    setLinkActionBusy(false)
    setLinkAction(null)
    setDetailRef(null)
    setDetailMode(false)
    setResultMessage(message)
  }

  function enterDetail(ref: SkillsShSkillRef): void {
    setResultMessage("")
    setDetailRef(ref)
    setSelectedLink("skillsSh")
    setLinkAction(null)
    setDetailMode(true)
  }

  async function install(): Promise<void> {
    if (installing() || linkActionBusy()) return
    const ref = detailRef()
    if (!ref) return
    setInstalling(true)
    try {
      const outcome = await props.onInstall(ref)
      if (disposed) return
      if (outcome.outcome === "installed") {
        dialog.clear()
        return
      }
      returnToList(outcome.message)
    } catch (cause) {
      if (!disposed) {
        returnToList(
          i18n.t("skillsSh.installFailed", {
            message: errorMessage(cause, i18n.locale()),
          }),
        )
      }
    } finally {
      if (!disposed) setInstalling(false)
    }
  }

  async function openSelectedLink(): Promise<void> {
    if (linkActionBusy()) return
    const ref = detailRef()
    if (!ref) return
    const url = buildSkillsShDetailUrls(ref)[selectedLink()]
    const myId = ++linkActionId
    setLinkActionBusy(true)
    setLinkAction({ kind: "loading", text: i18n.t("skillsSh.linkOpening") })
    try {
      await openExternalUrl(url)
      if (disposed || myId !== linkActionId) return
      setLinkAction({
        kind: "success",
        text: i18n.t("skillsSh.linkOpened", { url }),
      })
    } catch (cause) {
      if (disposed || myId !== linkActionId) return
      setLinkAction({
        kind: "error",
        text: i18n.t("skillsSh.linkOpenFailed", {
          message: errorMessage(cause, i18n.locale()),
        }),
      })
    } finally {
      if (!disposed && myId === linkActionId) setLinkActionBusy(false)
    }
  }

  useKeyboard((key) => {
    // AppShell 统一关闭弹窗；必须先于详情态的普通字母处理。
    if (key.name === "escape" || (key.ctrl && key.name === "c")) return

    if (detailMode()) {
      if (installing()) return
      if (key.name === "backspace") {
        returnToList()
        return
      }
      if (linkActionBusy()) return
      if (key.name === "tab" || key.sequence === "\t") {
        setSelectedLink((current) => nextSkillsShDetailLink(current))
        setLinkAction(null)
        return
      }
      if (key.name === "o" && !key.ctrl) {
        void openSelectedLink()
        return
      }
      if (key.name === "return") {
        void install()
        return
      }
      return
    }

    if (key.name === "return") {
      const ref = searchState.confirmSelect()
      if (ref) enterDetail(ref)
      return
    }
    if (key.name === "backspace") {
      searchState.backspace()
      return
    }
    if (key.name === "up") {
      searchState.moveCursor(-1)
      return
    }
    if (key.name === "down") {
      searchState.moveCursor(1)
      return
    }
    if (key.name === "left") {
      searchState.prevPage()
      return
    }
    if (key.name === "right") {
      searchState.nextPage()
      return
    }
    const ch = key.sequence
    if (ch && ch.length === 1 && /[\x20-\x7e]/.test(ch)) searchState.appendChar(ch)
  })

  usePaste((event: PasteEvent) => {
    if (detailMode()) return
    const text = Buffer.from(event.bytes).toString("utf8").replace(/[\x00-\x1f\x7f]/g, "")
    if (text) searchState.appendChar(text)
  })

  const searchStatusLine = (): string => {
    switch (searchState.phase()) {
      case "debouncing":
      case "loading":
        return i18n.t("skillsSh.searching")
      case "empty":
        return i18n.t("skillsSh.noResults")
      case "error": {
        const err = searchState.error()
        return err ? `[!] ${errorMessage(err, i18n.locale())}` : i18n.t("skillsSh.noResults")
      }
      default:
        return ""
    }
  }

  const pageFooter = (): string =>
    i18n.t("skillsSh.page", {
      n: searchState.page() + 1,
      total: searchState.totalPages(),
      limit: SKILLS_SH_SEARCH_LIMIT,
    })

  const listVisible = (): boolean =>
    searchState.phase() === "ready" && searchState.pageItems().length > 0

  const detailMetaLines = (): string[] => {
    const ref = detailRef()
    if (!ref) return []
    return i18n
      .t("skillsSh.confirmMessage", { name: ref.name, repo: ref.source, installs: ref.installs })
      .split("\n")
  }

  const detailUrls = () => {
    const ref = detailRef()
    return ref ? buildSkillsShDetailUrls(ref) : { skillsSh: "", github: "" }
  }

  const linkActionColor = () => {
    switch (linkAction()?.kind) {
      case "success":
        return theme.success
      case "error":
        return theme.warning
      default:
        return theme.textMuted
    }
  }

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {i18n.t("skillsSh.title")}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <Show
        when={detailMode()}
        fallback={
          <box flexDirection="column" gap={1}>
            <box height={1} flexDirection="row" alignItems="center">
              <text fg={searchState.query() ? theme.text : theme.textMuted} wrapMode="none">
                {searchState.query() || i18n.t("skillsSh.placeholder")}
              </text>
              <text fg={theme.primary}>▏</text>
            </box>
            <Show
              when={listVisible()}
              fallback={
                <Show
                  when={searchState.phase() === "idle"}
                  fallback={<text fg={theme.textMuted}>{searchStatusLine()}</text>}
                >
                  <box flexDirection="column">
                    <text fg={theme.textMuted}>{i18n.t("skillsSh.idleTip1")}</text>
                    <text fg={theme.textMuted}>{i18n.t("skillsSh.idleTip2")}</text>
                    <text fg={theme.textMuted}>{i18n.t("skillsSh.idleTip3")}</text>
                    <text fg={theme.textMuted}>{i18n.t("skillsSh.idleTip4")}</text>
                  </box>
                </Show>
              }
            >
              <box flexDirection="column">
                <For each={searchState.pageItems()}>
                  {(item, i) => {
                    const installed = searchState.isInstalled(item.skillId)
                    return (
                      <box
                        flexDirection="row"
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={i() === searchState.cursor() ? theme.primary : undefined}
                      >
                        <text fg={i() === searchState.cursor() ? theme.backgroundPanel : theme.text} wrapMode="none">
                          {fit(i() === searchState.cursor() ? "❯ " : "  ", 2)}
                        </text>
                        <text
                          fg={
                            i() === searchState.cursor()
                              ? theme.backgroundPanel
                              : installed
                                ? theme.textMuted
                                : theme.text
                          }
                          wrapMode="none"
                        >
                          {fit(installed ? "[✓]" : "[ ]", 4)}
                        </text>
                        <text fg={i() === searchState.cursor() ? theme.backgroundPanel : theme.text} wrapMode="none">
                          {fit(item.name, NAME_COL)}
                        </text>
                        <text fg={i() === searchState.cursor() ? theme.backgroundPanel : theme.textMuted} wrapMode="none">
                          {fit(item.source, SOURCE_COL)}
                        </text>
                        <text fg={i() === searchState.cursor() ? theme.backgroundPanel : theme.textMuted} wrapMode="none">
                          {i18n.t("skillsSh.installs", { n: item.installs })}
                        </text>
                      </box>
                    )
                  }}
                </For>
                <Show when={searchState.notice() === "installed"}>
                  <text fg={theme.warning}>[!] {i18n.t("skillsSh.alreadyInstalled")}</text>
                </Show>
                <Show when={resultMessage()}>
                  <text fg={theme.warning}>[!] {resultMessage()}</text>
                </Show>
              </box>
            </Show>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.textMuted}>{i18n.t("skillsSh.footer")}</text>
              <text fg={theme.textMuted}>{pageFooter()}</text>
            </box>
          </box>
        }
      >
        <box flexDirection="column" gap={1}>
          <box flexDirection="column">
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {i18n.t("skillsSh.confirmTitle")}
            </text>
            <For each={detailMetaLines()}>
              {(line) => <text fg={theme.text}>{line}</text>}
            </For>
          </box>

          <box flexDirection="column">
            <text fg={theme.textMuted}>{i18n.t("skillsSh.descriptionExternal")}</text>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {i18n.t("skillsSh.linksTitle")}
            </text>
            <text fg={selectedLink() === "skillsSh" ? theme.primary : theme.text} wrapMode="none">
              {selectedLink() === "skillsSh" ? "❯ " : "  "}
              {i18n.t("skillsSh.linkSkillsSh")}: {detailUrls().skillsSh}
            </text>
            <text fg={selectedLink() === "github" ? theme.primary : theme.text} wrapMode="none">
              {selectedLink() === "github" ? "❯ " : "  "}
              {i18n.t("skillsSh.linkGitHub")}: {detailUrls().github}
            </text>
            <Show when={linkAction()}>
              <text fg={linkActionColor()}>{linkAction()?.text}</text>
            </Show>
          </box>

          <text fg={theme.warning}>{i18n.t("skillsSh.riskWarning")}</text>

          <box paddingTop={1} flexDirection="column">
            <Show when={installing()} fallback={<text fg={theme.textMuted}>{i18n.t("skillsSh.confirmHint")}</text>}>
              <text fg={theme.primary}>{i18n.t("skillsSh.installing", { name: detailRef()?.name ?? "" })}</text>
            </Show>
          </box>
        </box>
      </Show>
    </box>
  )
}

export namespace SkillsShSearchDialog {
  export function show(
    dialog: DialogContextValue,
    onInstall: (ref: SkillsShSkillRef) => Promise<SkillsShInstallOutcome>,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      dialog.replace(() => <SkillsShSearchDialog onInstall={onInstall} />, () => resolve())
    })
  }
}
