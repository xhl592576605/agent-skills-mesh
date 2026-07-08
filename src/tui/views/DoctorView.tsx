import fs from "node:fs/promises"
import { useTerminalDimensions } from "@opentui/solid"
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme.js"
import { useI18n } from "../context/i18n.js"
import { useData } from "../context/data.js"
import { useDialog } from "../context/dialog.js"
import { useViewKey, type ViewKeyHandler } from "../context/view-key.js"
import { ConfigStore } from "../../core/storage/config-store.js"
import { IndexStore } from "../../core/storage/index-store.js"
import { StateStore } from "../../core/storage/state-store.js"
import { runDoctor, type DoctorCheck, type DoctorFix } from "../../core/services/doctor-service.js"
import { applyRepairPlan, buildRepairPlan } from "../../core/services/install-service.js"
import { ConfirmDialog } from "../dialogs/ConfirmDialog.js"
import { errorMessage } from "../../i18n/index.js"
import { Panel } from "../components/Panel.js"
import { DataTable, type Column } from "../components/DataTable.js"

/**
 * Doctor 视图（design §9 `doctor` 映射）。
 *
 * 展示 `runDoctor` checks（external/broken-link/orphan/source-missing/conflict/agent-dir/...），
 * 对可修复项（check.fix 存在）支持 `f` 单修 / `F` 全修：
 * - `refresh-index` → data.refresh()
 * - `mkdir-agent-dir` → fs.mkdir(targetPath, {recursive:true})
 * - `repair-broken-link` → buildRepairPlan + applyRepairPlan
 *
 * orphan/external 等无 fix 的项仅展示（adopt 候选提示用户去 source add / rebind）。
 *
 * **键盘路由**（design §6）：经 `useViewKey().setHandler` 注册内联 handler，本视图不自注册 useKeyboard。
 */
export function DoctorView() {
  const theme = useTheme()
  const i18n = useI18n()
  const data = useData()
  const dialog = useDialog()
  const viewKey = useViewKey()
  const dim = useTerminalDimensions()
  const [checks, setChecks] = createSignal<DoctorCheck[]>([])
  const [cursor, setCursor] = createSignal(0)
  const [message, setMessage] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  const selected = (): DoctorCheck | undefined => {
    const list = checks()
    const i = cursor()
    return i >= 0 && i < list.length ? list[i] : undefined
  }

  async function loadDoctor(): Promise<void> {
    const configStore = new ConfigStore()
    const indexStore = new IndexStore(configStore.home)
    try {
      const result = await runDoctor(
        configStore,
        indexStore,
        data.snapshot.config ?? undefined,
        data.snapshot.index ?? undefined
      )
      setChecks(result)
    } catch (err) {
      setMessage(i18n.t("doctorView.doctorFail", { message: errorMessage(err, i18n.locale()) }))
    }
  }

  // 首次 + index 变化（reload/refresh 后）时重跑 doctor。
  onMount(() => void loadDoctor())
  createEffect(() => {
    // 访问 snapshot.index 触发响应式追踪（refresh 后 index 引用变 → 重跑）。
    void data.snapshot.index?.updatedAt
    void data.snapshot.config?.version
    if (!data.snapshot.loading) void loadDoctor()
  })

  // cursor clamp（checks 变化时）。
  createEffect(() => {
    const max = Math.max(0, checks().length - 1)
    if (cursor() > max) setCursor(max)
  })

  const handler: ViewKeyHandler = (key) => {
    const k = key.name
    if (k === "up" || k === "k") {
      setCursor((c) => Math.max(0, c - 1))
      return true
    }
    if (k === "down" || k === "j") {
      setCursor((c) => Math.min(Math.max(0, checks().length - 1), c + 1))
      return true
    }
    // 注意：opentui KeyEvent 字母键 name 始终小写，shift 通过 key.shift 表示
    // （shift+f -> name="f" shift=true sequence="F"）。故用 key.shift 区分 f/F，
    // 且 shift 分支须在普通 f 之前判断，否则被 fixOne 吞掉。
    if (k === "f" && key.shift) {
      void fixAll()
      return true
    }
    if (k === "f") {
      void fixOne()
      return true
    }
    // 1/2/3/ctrl+r/esc/? 交回 AppShell。
    return false
  }
  onMount(() => viewKey.setHandler(handler))
  onCleanup(() => viewKey.setHandler(null))

  async function sync(): Promise<void> {
    await data.reload()
    await data.refresh()
    await loadDoctor()
  }

  async function fixOne(): Promise<void> {
    const check = selected()
    if (!check) return
    if (!check.fix) {
      setMessage(i18n.t("doctorView.noFix", { kind: check.kind }))
      return
    }
    const ok = await ConfirmDialog.show(
      dialog,
      i18n.t("doctorView.fixTitle", { kind: check.kind }),
      check.message,
      { confirmLabel: i18n.t("btn.fix"), cancelLabel: i18n.t("btn.cancel") }
    )
    if (!ok) return
    setBusy(true)
    try {
      await applyFix(check.fix)
      await sync()
      setMessage(i18n.t("doctorView.fixOk", { kind: check.kind }))
    } catch (err) {
      setMessage(i18n.t("doctorView.fixFail", { message: errorMessage(err, i18n.locale()) }))
    } finally {
      setBusy(false)
    }
  }

  async function fixAll(): Promise<void> {
    const fixable = checks().filter((c) => c.fix)
    if (fixable.length === 0) {
      setMessage(i18n.t("doctorView.noFixable"))
      return
    }
    const ok = await ConfirmDialog.show(
      dialog,
      i18n.t("doctorView.fixAllTitle"),
      i18n.t("doctorView.fixAllMsg", { count: fixable.length, kinds: fixable.map((c) => c.kind).join(", ") }),
      { confirmLabel: i18n.t("btn.fixAll"), cancelLabel: i18n.t("btn.cancel") }
    )
    if (!ok) return
    setBusy(true)
    const errors: string[] = []
    try {
      // 每次修复后 sync（reload/refresh/loadDoctor）让后续修复基于最新状态。
      for (const check of fixable) {
        try {
          await applyFix(check.fix!)
          await sync()
        } catch (err) {
          errors.push(`${check.kind}: ${errorMessage(err, i18n.locale())}`)
        }
      }
      setMessage(errors.length ? i18n.t("doctorView.fixAllResultPartial", { count: errors.length, errors: errors.join("; ") }) : i18n.t("doctorView.fixAllResultOk", { count: fixable.length }))
    } finally {
      setBusy(false)
    }
  }

  /** 按 fix.type 调度（「哪些可修复」的知识留在 doctor-service）。 */
  async function applyFix(fix: DoctorFix): Promise<void> {
    if (fix.type === "refresh-index") {
      await data.refresh()
      return
    }
    if (fix.type === "mkdir-agent-dir" && fix.targetPath) {
      await fs.mkdir(fix.targetPath, { recursive: true })
      return
    }
    if (fix.type === "repair-broken-link" && fix.skillName && fix.agentId) {
      const { config, index, state } = data.snapshot
      if (!config || !index || !state) throw new Error(i18n.t("doctorView.snapshotNotLoaded"))
      const plan = await buildRepairPlan(config, index, fix.skillName, fix.agentId, state)
      if (plan.hasConflict) throw new Error(i18n.t("doctorView.repairConflict", { warnings: plan.warnings.join("; ") }))
      await applyRepairPlan(plan)
      return
    }
    throw new Error(i18n.t("doctorView.unsupportedFix", { type: fix.type }))
  }

  const statusColor = (status: DoctorCheck["status"]) =>
    status === "ok" ? theme.success : status === "warning" ? theme.warning : theme.danger

  const statusLabel = (status: DoctorCheck["status"]) =>
    status === "ok" ? i18n.t("doctor.statusOk") : status === "warning" ? i18n.t("doctor.statusWarn") : i18n.t("doctor.statusError")

  const statusIcon = (status: DoctorCheck["status"]) =>
    status === "ok" ? "✓" : status === "warning" ? "⚠" : "!"

  const fixLabel = (check: DoctorCheck) => check.fix ? `${i18n.t("doctorView.fixable")} ${check.fix.type}` : i18n.t("doctorView.noAutoFix")

  // message 列宽度：总宽(panel 内) - prefix(5) - state(22) - kind(26) - message 分隔线(2)。
  const msgWidth = () => Math.max(20, dim().width - 57)
  const doctorColumns = (): Column<DoctorCheck>[] => [
    {
      key: "state",
      header: i18n.t("doctorView.headerState"),
      width: 20,
      render: (check) => ({ text: `${statusIcon(check.status)} ${statusLabel(check.status)}`, fg: statusColor(check.status) })
    },
    {
      key: "kind",
      header: i18n.t("doctorView.headerKind"),
      width: 24,
      render: (check, ctx) => ({ text: check.kind, fg: ctx.isCursorRow ? theme.text : theme.textMuted })
    },
    {
      key: "message",
      header: i18n.t("doctorView.headerMsg"),
      width: msgWidth(),
      render: (check) => ({ text: `${check.message}${check.fix ? `  ${i18n.t("doctorView.fixable")}` : ""}`, fg: theme.textMuted })
    }
  ]

  const statusLine = () => {
    if (busy()) return i18n.t("doctorView.working")
    if (message()) return message()
    const c = checks()
    const errors = c.filter((x) => x.status === "error").length
    const warns = c.filter((x) => x.status === "warning").length
    return i18n.t("doctorView.statusLine", { count: c.length, errors, warns })
  }

  return (
    <box flexDirection="column" flexGrow={1} width={Math.max(1, dim().width - 2)} gap={1}>
      <DataTable
        theme={theme}
        columns={doctorColumns()}
        rows={checks()}
        cursor={cursor()}
        rowHeight={1}
        flexGrow={1}
        fallback={<box paddingLeft={1}><text fg={theme.textMuted}>{i18n.t("doctorView.running")}</text></box>}
      />
      <Panel theme={theme} height={7} paddingLeft={1} paddingRight={1}>
        <Show when={selected()} fallback={<text fg={theme.textMuted}>{i18n.t("doctorView.running")}</text>}>
          {(check: () => DoctorCheck) => (
            <box flexDirection="row" gap={2} alignItems="center" flexGrow={1}>
              <box width={5} height={3} border={true} borderColor={theme.border} backgroundColor={theme.panelMuted} flexDirection="column" alignItems="center" justifyContent="center">
                <text fg={statusColor(check().status)} attributes={TextAttributes.BOLD}>{statusIcon(check().status)}</text>
              </box>
              <box flexDirection="column" flexGrow={1}>
                <box flexDirection="row"><text width={12} fg={theme.textMuted}>{i18n.t("doctorView.checkItem")}</text><text fg={theme.primary}>{check().kind}</text></box>
                <box flexDirection="row"><text width={12} fg={theme.textMuted}>{i18n.t("doctorView.headerState")}</text><text fg={statusColor(check().status)}>{statusIcon(check().status)} {statusLabel(check().status)}</text></box>
                <box flexDirection="row"><text width={12} fg={theme.textMuted}>{i18n.t("doctorView.headerMsg")}</text><text fg={theme.textMuted} wrapMode="none">{check().message}</text></box>
                <box flexDirection="row"><text width={12} fg={theme.textMuted}>{i18n.t("doctorView.fixLabel")}</text><text fg={check().fix ? theme.warning : theme.success} wrapMode="none">{fixLabel(check())}</text></box>
              </box>
            </box>
          )}
        </Show>
      </Panel>
      <Show when={busy() || message()}>
        <box height={1} backgroundColor={theme.panelMuted} paddingLeft={1} paddingRight={1}>
          <text fg={message() ? theme.warning : theme.textMuted}>{statusLine()}</text>
        </box>
      </Show>
    </box>
  )
}
