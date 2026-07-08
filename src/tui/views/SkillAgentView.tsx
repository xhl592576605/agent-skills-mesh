import { useTerminalDimensions } from "@opentui/solid"
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "../context/theme.js"
import { useI18n } from "../context/i18n.js"
import { useData } from "../context/data.js"
import { useDialog } from "../context/dialog.js"
import { useViewKey } from "../context/view-key.js"
import { ConfigStore } from "../../core/storage/config-store.js"
import { StateStore } from "../../core/storage/state-store.js"
import {
  applyInstallPlan,
  applyUninstallPlan,
  buildInstallPlan,
  buildUninstallPlan
} from "../../core/services/install-service.js"
import { ConfirmDialog } from "../dialogs/ConfirmDialog.js"
import { skillRemove } from "../../core/services/skill-service.js"
import { errorMessage } from "../../i18n/index.js"
import { SkillDetailDialog } from "../dialogs/SkillDetailDialog.js"
import { AgentManagerDialog } from "../dialogs/AgentManagerDialog.js"
import { createMatrixState, type MatrixState } from "../state/matrix.js"
import { createSearchState, filterSkills } from "../state/search.js"
import { buildAgentColumns, installationKey, type AgentColumn, type Intent } from "../state/projection.js"
import {
  createSkillAgentKeyHandler,
  type SkillAgentKeyDeps
} from "../state/skill-agent-keys.js"
import { Matrix } from "../components/Matrix.js"
import type { SkillRecord } from "../../core/models/skill.js"
import { SearchBar } from "../components/SearchBar.js"
import { Inspector } from "../components/Inspector.js"

// re-export 供外部（测试/child-3 参考）使用，保持「view 导出 key handler 契约」（design §6）。
export { createSkillAgentKeyHandler, type SkillAgentKeyDeps } from "../state/skill-agent-keys.js"

/**
 * Skill×Agent 视图（design §6/§4，Phase 3）。
 *
 * 装配 Matrix + Inspector + SearchBar，持有 matrix/search 状态，处理写操作链。
 *
 * **键盘路由（design §6 集中路由）**：本视图 **不自注册 useKeyboard**（opentui useKeyboard
 * 无 stopPropagation，多订阅会双触发）。改为导出 `createSkillAgentKeyHandler`，经
 * `ViewKeyContext` 注册给 AppShell 的单一 useKeyboard 集中派发：弹窗打开 → AppShell 拦截
 * （handler 不被调用）；否则 AppShell 调用本 handler，返回 true 表示消费（搜索态吞字符、
 * Matrix 操作），false 表示交回 AppShell 处理全局键（1/2/3 切 tab、ctrl+r refresh、ESC 退出）。
 *
 * 写操作链（安全模型，design §4）：用户 enter/a/d 只写本地 pending store →
 * `r` review → ConfirmDialog 确认 → 串行 buildInstallPlan/buildUninstallPlan +
 * applyInstallPlan/applyUninstallPlan（每次重读 state 保证连续操作正确）→
 * data.refresh() 回写 snapshot → 只清成功的 pending（失败项保留供重试）。
 */
export function SkillAgentView() {
  const theme = useTheme()
  const i18n = useI18n()
  const data = useData()
  const dialog = useDialog()
  const viewKey = useViewKey()
  const dim = useTerminalDimensions()
  const matrix: MatrixState = createMatrixState()
  const search = createSearchState()
  const [message, setMessage] = createSignal("")
  const [hasApplyError, setHasApplyError] = createSignal(false)

  // 预留行：AppHeader/TabBar/分隔线 + SearchBar + Inspector + StatusBar + 间距。
  const viewport = () => Math.max(1, dim().height - 17)
  const matrixNameWidth = () => Math.max(28, Math.min(46, Math.floor((dim().width - 8) * 0.22)))
  const matrixCellWidth = () => {
    const count = Math.max(1, columns().length)
    const available = Math.max(40, dim().width - matrixNameWidth() - 12)
    return Math.max(12, Math.min(34, Math.floor(available / count)))
  }

  // R1：matrix 行 = 已 add 到 SSOT 的 skill（与 `asm skill list` 语义一致）；
  // 从 state.installedSkills 取 name，回查 index.skills 拿 SkillRecord（含 status/tags 供搜索过滤）。
  const allSkills = () => {
    const idx = data.snapshot.index
    const st = data.snapshot.state
    if (!idx || !st) return []
    return Object.keys(st.installedSkills)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => idx.skills[name])
      .filter((s): s is SkillRecord => Boolean(s))
  }
  // matrix 只显示 enabled agent 列；agent 的启停/添加集中在 AgentManagerDialog（`A` 键弹出）。
  const columns = (): AgentColumn[] => {
    const cfg = data.snapshot.config
    return cfg ? buildAgentColumns(cfg.agents, { includeDisabled: false }) : []
  }
  const filtered = () => filterSkills(allSkills(), search.query())
  const installations = () => data.snapshot.index?.installations ?? {}
  const selected = () => {
    const rows = filtered()
    const r = matrix.cursor().row
    return r >= 0 && r < rows.length ? rows[r] : undefined
  }

  // 行/列数变化（搜索过滤、数据刷新、终端 resize）时 clamp cursor + scroll。
  // 行数变化（搜索过滤、数据刷新、agent 启停）后 clamp cursor.row + scrollOffset。
  // 不能在此 effect 里调 matrix.move：realign 读 cursor 使本 effect 依赖 cursor，而 move
  // 无条件 setCursor(新对象)，会触发本 effect 重新调度 → 无限递归（Maximum call stack）。
  // col 的 clamp 由方向键 handler（move）一次性完成；AgentManager 关闭后列变化若致 col 越界，
  // 用户按方向键即自愈（不在 effect 里 clamp col，避免写 cursor 引发递归）。
  createEffect(() => {
    matrix.realign(filtered().length, viewport())
  })

  // 集中键盘路由：注册 handler 给 AppShell，本视图不自注册 useKeyboard。
  const handleKey = createSkillAgentKeyHandler({
    matrix,
    search,
    rows: filtered,
    columns,
    installations,
    viewport,
    onReview: reviewAndApply,
    onInfo: () => {
      const s = selected()
      if (s) SkillDetailDialog.show(dialog, s.name)
    },
    onDeleteSkill: async (skillName: string) => {
      const ok = await ConfirmDialog.show(
        dialog,
        i18n.t("skillView.deleteTitle"),
        i18n.t("skillView.deleteMsg", { name: skillName }),
        { confirmLabel: i18n.t("btn.delete"), cancelLabel: i18n.t("btn.cancel") }
      )
      if (!ok) return
      try {
        const configStore = new ConfigStore()
        const stateStore = new StateStore(configStore.home)
        await skillRemove(configStore, stateStore, skillName)
        await data.reload()
        setMessage(i18n.t("skillView.deleted", { name: skillName }))
      } catch (err) {
        setMessage(i18n.t("skillView.deleteFail", { message: errorMessage(err, i18n.locale()) }))
      }
    },
    onManageAgents: () => {
      AgentManagerDialog.show(dialog)
    }
  })
  onMount(() => viewKey.setHandler(handleKey))
  onCleanup(() => viewKey.setHandler(null))

  function buildSummary(): string {
    const map = matrix.pending()
    let installs = 0
    let uninstalls = 0
    for (const row of Object.values(map)) {
      for (const v of Object.values(row)) {
        if (v === "install") installs++
        else uninstalls++
      }
    }
    const lines = [i18n.t("skillView.summaryTotal", { installs, uninstalls })]
    for (const [skillName, row] of Object.entries(map)) {
      const parts = Object.entries(row).map(([a, i]) => `${i === "install" ? "+" : "-"}${a}`)
      lines.push(i18n.t("skillView.summaryRow", { skill: skillName, parts: parts.join(" ") }))
    }
    return lines.join("\n")
  }

  async function reviewAndApply(): Promise<void> {
    if (!matrix.hasPending()) return
    const ok = await ConfirmDialog.show(dialog, i18n.t("skillView.applyTitle"), buildSummary(), {
      confirmLabel: i18n.t("btn.apply"),
      cancelLabel: i18n.t("btn.cancel")
    })
    if (!ok) return
    await applyPending()
  }

  /**
   * 串行执行 pending：每个 plan 用「最新 state」（apply 后重读），保证连续安装同一 skill
   * 到多个 agent 时，后续 plan 能看到前次 update-state 的结果（否则会误判 SSOT 已存在为 conflict）。
   *
   * 失败处理：只清成功的 pending，**保留失败项供用户重试**（避免丢失写意图）；
   * StatusBar 文案区分「全部成功 / 部分失败」。
   */
  async function applyPending(): Promise<void> {
    const { config, index, state } = data.snapshot
    if (!config || !index || !state) return
    const configStore = new ConfigStore()
    const stateStore = new StateStore(configStore.home)
    const pendingMap = matrix.pending()
    const errors: string[] = []
    const succeeded: Array<[string, string]> = []
    let currentState = state
    for (const [skillName, row] of Object.entries(pendingMap)) {
      for (const [agentId, intent] of Object.entries(row)) {
        try {
          await applyOne(config, index, skillName, agentId, intent, currentState, stateStore)
          currentState = await stateStore.read()
          succeeded.push([skillName, agentId])
        } catch (err) {
          errors.push(`${skillName}/${agentId}: ${errorMessage(err, i18n.locale())}`)
        }
      }
    }
    // 只清成功的，失败的保留供重试。
    for (const [skillName, agentId] of succeeded) matrix.clearIntent(skillName, agentId)
    // reload（而非 refresh）：install/uninstall 改写了 state.enabledAgents，refresh 只重建 index、
    // 仍用 apply 前的旧 state，会导致 detectInstallation 把新建的 symlink 误判为 external（[!]）。
    await data.reload()
    const failed = matrix.pendingCount()
    setHasApplyError(errors.length > 0)
    setMessage(
      errors.length
        ? i18n.t("skillView.appliedPartial", { ok: succeeded.length, failed })
        : i18n.t("skillView.appliedOk", { count: succeeded.length })
    )
  }

  async function applyOne(
    config: NonNullable<typeof data.snapshot.config>,
    index: NonNullable<typeof data.snapshot.index>,
    skillName: string,
    agentId: string,
    intent: Intent,
    state: NonNullable<typeof data.snapshot.state>,
    stateStore: StateStore
  ): Promise<void> {
    if (intent === "install") {
      const plan = await buildInstallPlan(config, index, skillName, agentId, state)
      if (plan.hasConflict) {
        const reason = plan.actions.find((a) => a.type === "conflict")
        throw new Error(reason && reason.type === "conflict" ? reason.reason : "conflict")
      }
      await applyInstallPlan(plan, stateStore)
    } else {
      const plan = await buildUninstallPlan(config, skillName, agentId, state)
      if (plan.hasConflict) {
        const reason = plan.actions.find((a) => a.type === "conflict")
        throw new Error(reason && reason.type === "conflict" ? reason.reason : "conflict")
      }
      await applyUninstallPlan(plan, stateStore)
    }
  }

  const statusLine = () =>
    message() ||
    (matrix.hasPending()
      ? i18n.t("skillView.pressReview", { count: matrix.pendingCount() })
      : i18n.t("skillView.skillCount", { count: filtered().length }))

  return (
    <box flexDirection="column" flexGrow={1} width={Math.max(1, dim().width - 2)} gap={1}>
      <SearchBar query={search.query()} active={search.active()} theme={theme} t={i18n.t} />
      <box flexGrow={1} flexDirection="column">
        <Show
          when={!data.snapshot.loading}
          fallback={<text fg={theme.textMuted}>{i18n.t("common.loading")}</text>}
        >
          <Show
            when={!data.snapshot.error}
            fallback={<text fg={theme.danger}>{i18n.t("common.errorLine", { message: data.snapshot.error?.message ?? "" })}</text>}
          >
            <Matrix
              rows={filtered()}
              columns={columns()}
              installations={installations()}
              matrix={matrix}
              theme={theme}
              t={i18n.t}
              viewport={viewport()}
              nameWidth={matrixNameWidth()}
              cellWidth={matrixCellWidth()}
            />
          </Show>
        </Show>
      </box>
      <Show when={message() || matrix.hasPending()}>
        <box height={1} backgroundColor={theme.panelMuted} paddingLeft={1} paddingRight={1}>
          <text fg={matrix.hasPending() ? theme.warning : theme.textMuted}>{statusLine()}</text>
        </box>
      </Show>
      <Inspector
        skill={selected()}
        columns={columns()}
        installations={installations()}
        matrix={matrix}
        theme={theme}
        t={i18n.t}
      />
      {/* 错误明细（apply 出错时滚动展示） */}
      <Show when={hasApplyError()}>
        <box paddingLeft={1}>
          <text fg={theme.danger}>{i18n.t("skillView.someConflicts")}</text>
        </box>
      </Show>
    </box>
  )
}
