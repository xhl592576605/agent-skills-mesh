import { useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "../context/theme.js"
import { useI18n, type TranslateFn } from "../context/i18n.js"
import { useData } from "../context/data.js"
import { useDialog } from "../context/dialog.js"
import { useViewKey } from "../context/view-key.js"
import { ConfigStore } from "../../core/storage/config-store.js"
import { IndexStore } from "../../core/storage/index-store.js"
import { StateStore } from "../../core/storage/state-store.js"
import {
  addSource,
  listSources,
  removeSource,
  setSourceEnabled,
  sourceUpdate,
  type SourceUpdateReport
} from "../../core/services/source-service.js"
import { refreshIndex } from "../../core/services/refresh-service.js"
import type { SourceConfig } from "../../core/models/config.js"
import { ConfirmDialog } from "../dialogs/ConfirmDialog.js"
import { SelectDialog } from "../dialogs/SelectDialog.js"
import { AddSourceDialog } from "../dialogs/AddSourceDialog.js"
import { MultiSelectDialog } from "../dialogs/MultiSelectDialog.js"
import { SkillMdDialog } from "../dialogs/SkillMdDialog.js"
import { skillAdd } from "../../core/services/skill-service.js"
import { errorMessage } from "../../i18n/index.js"
import path from "node:path"
import {
  createSourceKeyHandler,
  type SourceKeyDeps
} from "../state/source-keys.js"

// re-export 供测试使用，保持「view 导出 key handler 契约」（design §6）。
export { createSourceKeyHandler, type SourceKeyDeps } from "../state/source-keys.js"

/**
 * Source 视图（design §9 `source *` 映射）。
 *
 * source 列表（id/type/enabled/path/meta）+ 写操作链：
 * `a` add（AddSourceDialog）· `u` update（ConfirmDialog + sourceUpdate）·
 * `d` remove（SelectDialog purge 选项 + ConfirmDialog + removeSource）·
 * `e`/`x` enable/disable（setSourceEnabled）· `enter` detail（SelectDialog 选 source 的 skill →
 * SkillDetailDialog）。
 *
 * **键盘路由**（design §6）：经 `useViewKey().setHandler` 注册 `createSourceKeyHandler`，
 * 本视图不自注册 useKeyboard。写操作经弹窗确认 + core service + reload/refresh 回写。
 */
export function SourceView() {
  const theme = useTheme()
  const i18n = useI18n()
  const data = useData()
  const dialog = useDialog()
  const viewKey = useViewKey()
  const dim = useTerminalDimensions()
  const [cursor, setCursor] = createSignal(0)
  const [message, setMessage] = createSignal("")

  const sources = (): SourceConfig[] => {
    const cfg = data.snapshot.config
    return cfg ? listSources(cfg) : []
  }
  const selected = (): SourceConfig | undefined => {
    const rows = sources()
    const i = cursor()
    return i >= 0 && i < rows.length ? rows[i] : undefined
  }

  // 行数变化（数据刷新、reload）时 clamp cursor。
  createEffect(() => {
    const max = Math.max(0, sources().length - 1)
    if (cursor() > max) setCursor(max)
  })

  const handleKey = createSourceKeyHandler({
    cursor,
    rowCount: () => sources().length,
    setCursor,
    onAdd: doAdd,
    onUpdate: doUpdate,
    onRemove: doRemove,
    onEnable: () => doToggle(true),
    onDisable: () => doToggle(false),
    onDetail: doDetail
  })
  onMount(() => viewKey.setHandler(handleKey))
  onCleanup(() => viewKey.setHandler(null))

  /** 写操作后重读 config + 重建 index（source 改 config，需 reload 让新 source 进 snapshot）。 */
  async function sync(): Promise<void> {
    await data.reload()
    await data.refresh()
  }

  async function doAdd(): Promise<void> {
    const input = await AddSourceDialog.show(dialog, i18n.locale())
    if (!input) return
    try {
      const configStore = new ConfigStore()
      const stateStore = new StateStore(configStore.home)
      const result = await addSource(configStore, stateStore, input.target, {
        branch: input.branch,
        type: input.type
      })
      await sync()
      setMessage(
        i18n.t("sourceView.addOk", { id: result.source.id, type: result.source.type }) +
          (result.reboundOrphans.length ? i18n.t("sourceView.reboundSuffix", { list: result.reboundOrphans.join(", ") }) : "")
      )
    } catch (err) {
      setMessage(i18n.t("sourceView.addFail", { message: errorMessage(err, i18n.locale()) }))
    }
  }

  async function doUpdate(): Promise<void> {
    const src = selected()
    if (!src) {
      setMessage(i18n.t("sourceView.noSource"))
      return
    }
    const ok = await ConfirmDialog.show(
      dialog,
      i18n.t("sourceView.updateTitle"),
      i18n.t("sourceView.updateMsg", { id: src.id, type: src.type, target: src.url ?? src.path }),
      { confirmLabel: i18n.t("btn.update"), cancelLabel: i18n.t("btn.cancel") }
    )
    if (!ok) return
    try {
      const configStore = new ConfigStore()
      const stateStore = new StateStore(configStore.home)
      const reports = await sourceUpdate(configStore, stateStore, src.id)
      // sourceUpdate 内部不重建 index；显式 refreshIndex 写回（与 CLI 一致）。
      const config = await configStore.read()
      const state = await stateStore.read()
      const indexStore = new IndexStore(configStore.home)
      await indexStore.write(await refreshIndex(config, state))
      await data.reload()
      setMessage(formatUpdateReport(reports, i18n.t))
    } catch (err) {
      setMessage(i18n.t("sourceView.updateFail", { message: errorMessage(err, i18n.locale()) }))
    }
  }

  async function doRemove(): Promise<void> {
    const src = selected()
    if (!src) {
      setMessage(i18n.t("sourceView.noSource"))
      return
    }
    // purge 选项（SelectDialog）：keep=保留 SSOT（orphan）/ purge=级联删除。
    const purgeChoice = await SelectDialog.show<"keep" | "purge">(dialog, i18n.t("sourceView.removeTitleKeep", { id: src.id }), [
      { label: i18n.t("sourceView.keepSsot"), value: "keep", description: i18n.t("sourceView.keepDesc") },
      { label: i18n.t("sourceView.purgeOpt"), value: "purge", description: i18n.t("sourceView.purgeDesc") }
    ])
    if (purgeChoice === undefined) return
    const purge = purgeChoice === "purge"
    const ok = await ConfirmDialog.show(
      dialog,
      purge ? i18n.t("sourceView.confirmPurge") : i18n.t("sourceView.confirmRemove"),
      `${src.id}\n${purge ? i18n.t("sourceView.cascadeDelete") : i18n.t("sourceView.becomeOrphan")}`,
      { confirmLabel: purge ? i18n.t("btn.purge") : i18n.t("btn.remove"), cancelLabel: i18n.t("btn.cancel") }
    )
    if (!ok) return
    try {
      const configStore = new ConfigStore()
      const stateStore = new StateStore(configStore.home)
      const result = await removeSource(configStore, stateStore, src.id, { purge })
      await sync()
      setMessage(
        purge
          ? i18n.t("sourceView.removedPurged", { id: src.id, list: result.purged.join(", ") || i18n.t("common.none") })
          : i18n.t("sourceView.removedOrphaned", { id: src.id, list: result.orphaned.join(", ") || i18n.t("common.none") })
      )
    } catch (err) {
      setMessage(i18n.t("sourceView.removeFail", { message: errorMessage(err, i18n.locale()) }))
    }
  }

  async function doToggle(enabled: boolean): Promise<void> {
    const src = selected()
    if (!src) {
      setMessage(i18n.t("sourceView.noSource"))
      return
    }
    try {
      const configStore = new ConfigStore()
      await setSourceEnabled(configStore, src.id, enabled)
      await data.reload()
      setMessage(i18n.t(enabled ? "sourceView.enabled" : "sourceView.disabled", { id: src.id }))
    } catch (err) {
      setMessage(i18n.t(enabled ? "sourceView.enableFail" : "sourceView.disableFail", { message: errorMessage(err, i18n.locale()) }))
    }
  }

  /**
   * 展示 source 贡献的 skill 列表（R4 多选）：标记已 add、space 多选、i 看 SKILL.md、return 批量 add。
   */
  async function doDetail(): Promise<void> {
    const src = selected()
    if (!src) return
    const index = data.snapshot.index
    const state = data.snapshot.state
    if (!index || !state) return
    const skillsOfSource = Object.values(index.skills)
      .filter((s) => s.candidates.some((c) => c.sourceId === src.id))
      .sort((a, b) => a.name.localeCompare(b.name))
    if (skillsOfSource.length === 0) {
      setMessage(i18n.t("sourceView.noIndexedSkills", { id: src.id }))
      return
    }
    const options = skillsOfSource.map((s) => {
      const cand = s.candidates.find((c) => c.sourceId === src.id)!
      return {
        label: s.name,
        value: { name: s.name, mdPath: path.join(cand.path, "SKILL.md") } as { name: string; mdPath: string },
        description: s.status,
        locked: Boolean(state.installedSkills[s.name]),
      }
    })
    const chosen = await MultiSelectDialog.show(dialog, i18n.t("sourceView.skillsTitle", { id: src.id }), options, {
      onInspect: (v) => SkillMdDialog.show(dialog, v.name, v.mdPath),
    })
    if (!chosen || chosen.length === 0) return
    const configStore = new ConfigStore()
    const stateStore = new StateStore(configStore.home)
    const added: string[] = []
    const failed: string[] = []
    for (const item of chosen) {
      try {
        await skillAdd(configStore, stateStore, index, item.name)
        added.push(item.name)
      } catch (err) {
        failed.push(`${item.name} (${errorMessage(err, i18n.locale())})`)
      }
    }
    await sync()
    setMessage(
      i18n.t("sourceView.addedResult", { list: added.join(", ") || i18n.t("common.none") }) +
        (failed.length ? i18n.t("sourceView.failedSuffix", { list: failed.join(", ") }) : "")
    )
  }

  const statusLine = () => message() || i18n.t("sourceView.sourceCount", { count: sources().length })

  return (
    <box flexDirection="column" flexGrow={1} width={dim().width}>
      {/* 表头 */}
      <box flexDirection="row" backgroundColor={theme.backgroundPanel} paddingLeft={1} paddingRight={1}>
        <text width={16} fg={theme.textMuted}>{i18n.t("sourceView.headerId")}</text>
        <text width={13} fg={theme.textMuted}>{i18n.t("sourceView.headerType")}</text>
        <text width={9} fg={theme.textMuted}>{i18n.t("sourceView.headerEnabled")}</text>
        <text fg={theme.textMuted}>{i18n.t("sourceView.headerPathMeta")}</text>
      </box>
      <box flexGrow={1} flexDirection="column">
        <Show
          when={!data.snapshot.loading}
          fallback={<text fg={theme.textMuted}>{i18n.t("common.loading")}</text>}
        >
          <Show
            when={!data.snapshot.error}
            fallback={<text fg={theme.danger}>{i18n.t("common.errorLine", { message: data.snapshot.error?.message ?? "" })}</text>}
          >
            <Show
              when={sources().length > 0}
              fallback={
                <box paddingLeft={1}>
                  <text fg={theme.textMuted}>{i18n.t("sourceView.noSources")}</text>
                </box>
              }
            >
              <For each={sources()}>
                {(src, i) => (
                  <box
                    flexDirection="row"
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={i() === cursor() ? theme.primary : undefined}
                  >
                    <text
                      width={16}
                      fg={i() === cursor() ? theme.backgroundPanel : theme.text}
                      wrapMode="none"
                    >
                      {src.id}
                    </text>
                    <text
                      width={13}
                      fg={i() === cursor() ? theme.backgroundPanel : theme.textMuted}
                    >
                      {src.type}
                    </text>
                    <text
                      width={9}
                      fg={
                        i() === cursor()
                          ? theme.backgroundPanel
                          : src.enabled
                            ? theme.success
                            : theme.warning
                      }
                    >
                      {src.enabled ? i18n.t("status.enabled") : i18n.t("status.disabled")}
                    </text>
                    <text
                      fg={i() === cursor() ? theme.backgroundPanel : theme.textMuted}
                      wrapMode="none"
                    >
                      {src.path}
                      {src.url ? `  url=${src.url}` : ""}
                      {src.branch ? `  branch=${src.branch}` : ""}
                    </text>
                  </box>
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </box>
      {/* 状态/提示行 */}
      <box height={1} backgroundColor={theme.backgroundPanel} paddingLeft={1} paddingRight={1}>
        <text fg={message() ? theme.warning : theme.textMuted}>{statusLine()}</text>
      </box>
    </box>
  )
}

function formatUpdateReport(reports: SourceUpdateReport[], t: TranslateFn): string {
  if (!reports.length) return t("sourceView.noSourcesUpdated")
  const r = reports[0]
  const detail = r.success
    ? r.updatableSkills.length
      ? t("status.updatable", { list: r.updatableSkills.join(", ") })
      : t("status.upToDate")
    : t("status.failedDetail", { error: r.error ?? "unknown" })
  return t("sourceView.reportLine", { sourceId: r.sourceId, detail })
}
