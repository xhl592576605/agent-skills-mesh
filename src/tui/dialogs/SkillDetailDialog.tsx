import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { For, Show, createMemo, type ParentProps } from "solid-js"
import { useTheme } from "../context/theme.js"
import { useData } from "../context/data.js"
import { useDialog, type DialogContextValue } from "../context/dialog.js"
import { ConfigStore } from "../../core/storage/config-store.js"
import { IndexStore } from "../../core/storage/index-store.js"
import { StateStore } from "../../core/storage/state-store.js"
import { skillAdd, skillRebind, skillRemove, skillUpdate } from "../../core/services/skill-service.js"
import { refreshIndex } from "../../core/services/refresh-service.js"
import { ConfirmDialog } from "./ConfirmDialog.js"
import { SelectDialog } from "./SelectDialog.js"

/**
 * Skill 详情弹窗（design §9 `skill info` / `update` / `remove` / `rebind` / `add` 映射）。
 *
 * 展示 + 交互：name/status/candidates/ssot/hash/agents/installations，并支持就地操作：
 * - `u` update SSOT 到 source 最新版（ConfirmDialog + skillUpdate）
 * - `d` remove SSOT + 所有 symlink（ConfirmDialog + skillRemove）
 * - `b` rebind 到其他 source（SelectDialog + skillRebind）
 * - `+` add（从 source 复制进 SSOT，未 installed 时；ConfirmDialog + skillAdd）
 *
 * ESC/ctrl+c/遮罩点击由 DialogProvider 统一关闭。操作完成后 reload + 重开详情（remove 除外）。
 */
export interface SkillDetailDialogProps {
  skillName: string
}

export function SkillDetailDialog(props: ParentProps<SkillDetailDialogProps>) {
  const theme = useTheme()
  const data = useData()
  const dialog = useDialog()

  const skill = createMemo(() => data.snapshot.index?.skills[props.skillName])
  const installed = createMemo(() => data.snapshot.state?.installedSkills[props.skillName])
  const installations = createMemo(() =>
    data.snapshot.index
      ? Object.values(data.snapshot.index.installations).filter(
          (i) => i.skillName === props.skillName
        )
      : []
  )
  /** rebind 候选 source（skill.candidates 的 sourceId，去重）。 */
  const rebindSources = createMemo(() => {
    const s = skill()
    return s ? Array.from(new Set(s.candidates.map((c) => c.sourceId))) : []
  })

  useKeyboard((key) => {
    // 弹窗内操作键；ESC/ctrl+c 由 AppShell 统一关弹窗（不在此处理）。
    if (key.name === "u") {
      void doUpdate()
    } else if (key.name === "d") {
      void doRemove()
    } else if (key.name === "b") {
      void doRebind()
    } else if (key.sequence === "+") {
      void doAdd()
    }
  })

  /** 写后重读 config/state/index（skill 操作改 state，需 reload；再 refreshIndex 让 hash 更新进 index）。 */
  async function sync(): Promise<void> {
    await data.reload()
    const configStore = new ConfigStore()
    const config = await configStore.read()
    const stateStore = new StateStore(configStore.home)
    const state = await stateStore.read()
    const indexStore = new IndexStore(configStore.home)
    await indexStore.write(await refreshIndex(config, state))
    await data.reload()
  }

  /** 重开详情（操作后 source/hash 可能变化，重新渲染）。 */
  function reopen(): void {
    SkillDetailDialog.show(dialog, props.skillName)
  }

  async function doUpdate(): Promise<void> {
    if (!installed()) return
    const ok = await ConfirmDialog.show(
      dialog,
      "Update skill?",
      `${props.skillName}\nSSOT -> source latest version`,
      { confirmLabel: "update", cancelLabel: "cancel" }
    )
    if (!ok) return
    try {
      const configStore = new ConfigStore()
      const stateStore = new StateStore(configStore.home)
      await skillUpdate(configStore, stateStore, props.skillName)
      await sync()
      reopen()
    } catch (err) {
      void ConfirmDialog.show(dialog, "Update failed", errMsg(err), {
        confirmLabel: "ok",
        cancelLabel: "ok"
      })
    }
  }

  async function doRemove(): Promise<void> {
    if (!installed()) return
    const ok = await ConfirmDialog.show(
      dialog,
      "Remove skill?",
      `${props.skillName}\ndelete SSOT + detach all agent symlinks`,
      { confirmLabel: "remove", cancelLabel: "cancel" }
    )
    if (!ok) return
    try {
      const configStore = new ConfigStore()
      const stateStore = new StateStore(configStore.home)
      await skillRemove(configStore, stateStore, props.skillName)
      await sync()
      // skill 已删，不重开详情（dialog.clear 已由 ConfirmDialog commit 执行，这里保险再 clear）。
      dialog.clear()
    } catch (err) {
      void ConfirmDialog.show(dialog, "Remove failed", errMsg(err), {
        confirmLabel: "ok",
        cancelLabel: "ok"
      })
    }
  }

  async function doRebind(): Promise<void> {
    if (!installed()) return
    const opts = rebindSources()
    if (opts.length === 0) {
      void ConfirmDialog.show(
        dialog,
        "No rebind candidates",
        `${props.skillName} has no source candidates`,
        { confirmLabel: "ok", cancelLabel: "ok" }
      )
      return
    }
    const sourceId = await SelectDialog.show(
      dialog,
      "Rebind to source",
      opts.map((id) => ({ label: id, value: id }))
    )
    if (sourceId === undefined) return
    try {
      const configStore = new ConfigStore()
      const stateStore = new StateStore(configStore.home)
      const index = data.snapshot.index
      if (!index) return
      await skillRebind(configStore, stateStore, index, props.skillName, sourceId)
      await sync()
      reopen()
    } catch (err) {
      void ConfirmDialog.show(dialog, "Rebind failed", errMsg(err), {
        confirmLabel: "ok",
        cancelLabel: "ok"
      })
    }
  }

  /** 未 installed 时从 source 复制进 SSOT（对应 CLI `skill add`）。 */
  async function doAdd(): Promise<void> {
    if (installed()) return
    const ok = await ConfirmDialog.show(
      dialog,
      "Add skill to SSOT?",
      `${props.skillName}\ncopy from source into SSOT`,
      { confirmLabel: "add", cancelLabel: "cancel" }
    )
    if (!ok) return
    try {
      const configStore = new ConfigStore()
      const stateStore = new StateStore(configStore.home)
      const index = data.snapshot.index
      if (!index) return
      await skillAdd(configStore, stateStore, index, props.skillName)
      await sync()
      reopen()
    } catch (err) {
      void ConfirmDialog.show(dialog, "Add failed", errMsg(err), {
        confirmLabel: "ok",
        cancelLabel: "ok"
      })
    }
  }

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.skillName}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <Show when={skill()} fallback={<text fg={theme.danger}>Skill not found: {props.skillName}</text>}>
        <box flexDirection="column">
          <text fg={theme.textMuted}>
            status: <span style={{ fg: theme.text }}>{skill()!.status}</span>
          </text>
          <Show when={skill()!.description}>
            <text fg={theme.textMuted} wrapMode="none">
              desc: {skill()!.description}
            </text>
          </Show>
          <text fg={theme.accent}>candidates:</text>
          <For each={skill()!.candidates}>
            {(c) => (
              <box paddingLeft={1} flexDirection="column">
                <text fg={theme.textMuted} wrapMode="none">
                  - {c.sourceId} ({c.sourceType})
                </text>
                <text fg={theme.textMuted} wrapMode="none">
                  {"  "}path: {c.path}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      <Show when={installed()}>
        <box flexDirection="column">
          <text fg={theme.accent}>installed:</text>
          <text fg={theme.textMuted} wrapMode="none">
            ssot: {installed()!.ssotPath}
          </text>
          <text fg={theme.textMuted} wrapMode="none">
            hash: {installed()!.contentHash.slice(0, 12)}
          </text>
          <text fg={theme.textMuted}>
            agents: {Object.keys(installed()!.enabledAgents).join(", ") || "(none)"}
          </text>
        </box>
      </Show>

      <Show when={installations().length > 0}>
        <box flexDirection="column">
          <text fg={theme.accent}>installations:</text>
          <For each={installations()}>
            {(inst) => (
              <text fg={theme.textMuted} wrapMode="none">
                - {inst.agentId}: {inst.status} {inst.targetPath}
              </text>
            )}
          </For>
        </box>
      </Show>

      {/* 操作提示（installed 时 u/d/b；未 installed 时 +） */}
      <box flexDirection="row" gap={1}>
        <Show when={installed()}>
          <text fg={theme.textMuted}>u update · d remove · b rebind ·</text>
        </Show>
        <Show when={!installed()}>
          <text fg={theme.textMuted}>+ add ·</text>
        </Show>
        <text fg={theme.textMuted}>esc close</text>
      </box>
    </box>
  )
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export namespace SkillDetailDialog {
  /** 弹出 skill 详情（fire-and-forget）。dialog 由调用侧的 useDialog 提供。 */
  export function show(dialog: DialogContextValue, skillName: string): void {
    dialog.replace(() => <SkillDetailDialog skillName={skillName} />)
  }
}
