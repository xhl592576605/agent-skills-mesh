import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { For, createSignal, type ParentProps } from "solid-js"
import { useTheme } from "../context/theme.js"
import { useI18n } from "../context/i18n.js"
import { useData } from "../context/data.js"
import { useDialog, type DialogContextValue } from "../context/dialog.js"
import { errorMessage } from "../../i18n/index.js"
import { ConfigStore, isBuiltinAgent } from "../../core/storage/config-store.js"
import { StateStore } from "../../core/storage/state-store.js"
import { addAgent, listAgents, removeAgent, setAgentEnabled, type AgentRow } from "../../core/services/agent-service.js"
import { AddAgentDialog } from "./AddAgentDialog.js"
import { ConfirmDialog } from "./ConfirmDialog.js"

/**
 * Agent 管理弹窗（task 07-06-cli-tui-bugfix · R5+）。
 *
 * 集中管理 agent：列出全部（[✓]enabled/[ ]disabled + installed 检测），
 * `space` 即时启停、`a` 添加自定义 agent（弹 AddAgentDialog）。
 * 替代 matrix 上散落的 +/E/X 键，一个 `A` 键进入，交互集中清晰。
 * esc/ctrl+c/遮罩点击由 DialogProvider 统一关闭。
 */
export function AgentManagerDialog(props: ParentProps) {
  const theme = useTheme()
  const i18n = useI18n()
  const data = useData()
  const dialog = useDialog()
  const [agents, setAgents] = createSignal<AgentRow[]>([])
  const [sel, setSel] = createSignal(0)
  const [message, setMessage] = createSignal("")

  async function reload(): Promise<void> {
    const cfg = data.snapshot.config
    if (cfg) setAgents(await listAgents(cfg))
  }
  void reload()

  function move(delta: number): void {
    const list = agents()
    if (!list.length) return
    const n = list.length
    let next = sel() + delta
    if (next < 0) next = n - 1
    else if (next >= n) next = 0
    setSel(next)
  }

  async function toggle(): Promise<void> {
    const a = agents()[sel()]
    if (!a) return
    try {
      const configStore = new ConfigStore()
      await setAgentEnabled(configStore, a.id, !a.enabled)
      await data.reload()
      await reload()
      setMessage(i18n.t(!a.enabled ? "agentManager.enabled" : "agentManager.disabled", { id: a.id }))
    } catch (err) {
      setMessage(i18n.t("agentManager.toggleFail", { message: errorMessage(err, i18n.locale()) }))
    }
  }

  async function addFlow(): Promise<void> {
    const input = await AddAgentDialog.show(dialog, i18n.locale())
    if (!input) return
    try {
      const configStore = new ConfigStore()
      await addAgent(configStore, input.id, { skillsDir: input.skillsDir, name: input.name })
      await data.reload()
      AgentManagerDialog.show(dialog)  // 重开 manager：新增后刷新列表（旧实例随 AddAgentDialog 卸载）
    } catch (err) {
      setMessage(i18n.t("agentManager.addFail", { message: errorMessage(err, i18n.locale()) }))
    }
  }

  async function removeFlow(): Promise<void> {
    const a = agents()[sel()]
    if (!a) return
    if (isBuiltinAgent(a.id)) {
      setMessage(i18n.t("agentManager.builtinCannotRemove", { id: a.id }))
      return
    }
    const ok = await ConfirmDialog.show(
      dialog,
      i18n.t("agentManager.removeTitle", { id: a.id }),
      i18n.t("agentManager.removeMsg", { dir: a.skills_dir }),
      { confirmLabel: i18n.t("btn.remove"), cancelLabel: i18n.t("btn.cancel") }
    )
    if (!ok) return
    try {
      const configStore = new ConfigStore()
      const stateStore = new StateStore(configStore.home)
      await removeAgent(configStore, stateStore, a.id)
      await data.reload()
      AgentManagerDialog.show(dialog)  // 重开 manager：删除生效后刷新列表
    } catch (err) {
      setMessage(i18n.t("agentManager.removeFail", { message: errorMessage(err, i18n.locale()) }))
    }
  }

  useKeyboard((key) => {
    if (key.name === "up" || key.name === "k") {
      move(-1)
      return
    }
    if (key.name === "down" || key.name === "j") {
      move(1)
      return
    }
    if (key.name === "space" || key.sequence === " ") {
      void toggle()
      return
    }
    if (key.name === "a") {
      void addFlow()
      return
    }
    if (key.name === "d") {
      void removeFlow()
      return
    }
    // ESC / ctrl+c 由 AppShell 关弹窗。
  })

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {i18n.t("agentManager.title")}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box flexDirection="column">
        <For each={agents()}>
          {(a, i) => (
            <box
              flexDirection="row"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={i() === sel() ? theme.primary : undefined}
            >
              <text fg={i() === sel() ? theme.backgroundPanel : theme.text}>
                {i() === sel() ? "❯" : " "} {a.enabled ? "[✓]" : "[ ]"} {a.id}{isBuiltinAgent(a.id) ? "" : i18n.t("common.customSuffix")} ({a.installed ? i18n.t("status.installed") : i18n.t("status.missing")})
              </text>
            </box>
          )}
        </For>
      </box>
      <text fg={message() ? theme.warning : theme.textMuted}>
        {message() || i18n.t("agentManager.footer")}
      </text>
    </box>
  )
}

export namespace AgentManagerDialog {
  /** 弹出 agent 管理界面（fire-and-forget）。 */
  export function show(dialog: DialogContextValue): void {
    dialog.replace(() => <AgentManagerDialog />)
  }
}
