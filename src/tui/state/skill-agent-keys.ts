import type { KeyEvent } from "@opentui/core"
import type { InstallationRecord } from "../../core/models/installation.js"
import type { SkillRecord } from "../../core/models/skill.js"
import type { MatrixState } from "./matrix.js"
import type { SearchState } from "./search.js"
import type { ViewKeyHandler } from "../context/view-key.js"
import { baseCellKind, installationKey } from "./projection.js"

/**
 * SkillAgentView 的按键处理纯逻辑（design §6 集中路由的 view 侧 handler）。
 *
 * 从 view 组件抽出独立模块：仅依赖 matrix/projection 纯函数 + 类型，**不依赖 opentui
 * 运行时**（KeyEvent 是 type-only import），便于在不渲染 TUI 的单元测试里直接断言
 * 键路由（搜索态吞字符、ctrl+r fallthrough、Matrix 操作消费等）。
 *
 * handler 语义：返回 true=已消费（AppShell 跳过全局键），false=交回 AppShell 全局键。
 */

/** `createSkillAgentKeyHandler` 依赖：响应式数据 accessor + review 回调。 */
export interface SkillAgentKeyDeps {
  matrix: MatrixState
  search: SearchState
  rows: () => readonly SkillRecord[]
  columns: () => readonly AgentColumnLike[]
  installations: () => Record<string, InstallationRecord>
  viewport: () => number
  /** 按下 review 键（`r`）时触发，由组件注入写操作链（ConfirmDialog → apply）。 */
  onReview: () => void | Promise<void>
  /** 按下 info 键（`i`）时触发，由组件注入 SkillDetailDialog（child-3）。可选：未注入时 `i` fallthrough。 */
  onInfo?: () => void | Promise<void>
  /** 按下 `d` 删除当前 skill（从 SSOT 移除 + 断所有 agent symlink）。可选：未注入时 fallthrough。 */
  onDeleteSkill?: (skillName: string) => void | Promise<void>
  /** 按下 `m` 打开 agent 管理弹窗（Manage agents：启停/添加）。可选：未注入时 fallthrough。 */
  onManageAgents?: () => void
}

/** columns accessor 的最小结构（与 projection.AgentColumn 同构，解耦避免循环类型依赖）。 */
export interface AgentColumnLike {
  id: string
  enabled: boolean
}

/**
 * 创建 SkillAgentView 的按键 handler。
 *
 * - 搜索激活：吞所有可打印键与 ESC/return/backspace（ctrl/meta 组合键 fallthrough，让 ctrl+r 仍 refresh）
 * - 非搜索：处理 `↑↓←→`/`hjkl`/`enter`(toggle)/`a`(行全装)/`d`(行全卸)/`r`(review)/`/`(搜索)；
 *   其余键返回 false 交回 AppShell 全局键（1/2/3/ctrl+r/esc）
 */
export function createSkillAgentKeyHandler(deps: SkillAgentKeyDeps): ViewKeyHandler {
  const { search } = deps
  return (key: KeyEvent): boolean => {
    if (search.active()) {
      // 搜索态：ctrl/meta 组合键（如 ctrl+r）fallthrough 给 AppShell；其余键搜索消费。
      if (key.ctrl || key.meta) return false
      handleSearchKey(search, key)
      return true
    }
    return handleMatrixKey(deps, key)
  }
}

/** 搜索态字符收集：ESC 退出并清词、return 退出保留词、backspace 删尾、可打印 ASCII 追加。 */
export function handleSearchKey(search: SearchState, key: KeyEvent): void {
  if (key.name === "escape") {
    search.exit(true)
    return
  }
  if (key.name === "return") {
    search.exit(false)
    return
  }
  if (key.name === "backspace") {
    search.setQuery(search.query().slice(0, -1))
    return
  }
  const ch = key.sequence
  if (ch && ch.length === 1 && /[\x20-\x7e]/.test(ch)) {
    search.setQuery(search.query() + ch)
  }
}

/** Matrix 操作键。返回 true=已消费，false=交回 AppShell 全局键。 */
export function handleMatrixKey(deps: SkillAgentKeyDeps, key: KeyEvent): boolean {
  const { matrix, search } = deps
  const rows = deps.rows()
  const cols = deps.columns()
  const rowCount = rows.length
  const colCount = cols.length
  const k = key.name
  if (k === "up" || k === "k") {
    matrix.move(-1, 0, rowCount, colCount, deps.viewport())
    return true
  }
  if (k === "down" || k === "j") {
    matrix.move(1, 0, rowCount, colCount, deps.viewport())
    return true
  }
  if (k === "left" || k === "h") {
    matrix.move(0, -1, rowCount, colCount, deps.viewport())
    return true
  }
  if (k === "right" || k === "l") {
    matrix.move(0, 1, rowCount, colCount, deps.viewport())
    return true
  }
  if (k === "return") {
    toggleCurrent(deps)
    return true
  }
  if (k === "a") {
    rowAll(deps, true)
    return true
  }
  // `d` 删除当前 skill（从 SSOT 移除 + 断所有 symlink）；未注入 onDeleteSkill 时 fallthrough。
  if (k === "d") {
    if (deps.onDeleteSkill) {
      const skill = deps.rows()[deps.matrix.cursor().row]
      if (skill) void deps.onDeleteSkill(skill.name)
      return true
    }
    return false
  }
  // `i` 弹 skill 详情（SkillDetailDialog）；未注入 onInfo 时 fallthrough 交回 AppShell。
  if (k === "i") {
    if (deps.onInfo) {
      void deps.onInfo()
      return true
    }
    return false
  }
  // `m` 打开 agent 管理弹窗（Manage agents：启停/添加）；未注入时 fallthrough。
  // 用 m 而非 A，避免与小写 a（行全装）大小写重复、视觉混淆。
  if (k === "m" && deps.onManageAgents) {
    deps.onManageAgents()
    return true
  }
  // `r` 触发 review；ctrl+r（key.ctrl=true）不在此处理，fallthrough 给 AppShell 做 refresh。
  if (k === "r" && !key.ctrl) {
    void deps.onReview()
    return true
  }
  if (key.sequence === "/") {
    search.enter()
    return true
  }
  // 其余键（1/2/3/ctrl+r/esc/? 等）交回 AppShell 全局键处理。
  return false
}

/** toggle 当前格：取消已有 pending；否则 on→uninstall，off/warning→install。 */
export function toggleCurrent(deps: SkillAgentKeyDeps): void {
  const rows = deps.rows()
  const cols = deps.columns()
  const c = deps.matrix.cursor()
  const skill = rows[c.row]
  const col = cols[c.col]
  if (!skill || !col || !col.enabled) return
  const base = baseCellKind(deps.installations()[installationKey(skill.name, col.id)], col.enabled)
  const matrix = deps.matrix
  if (matrix.intentFor(skill.name, col.id)) {
    matrix.clearIntent(skill.name, col.id)
  } else if (base === "on") {
    matrix.setIntent(skill.name, col.id, "uninstall")
  } else {
    matrix.setIntent(skill.name, col.id, "install")
  }
}

/** 当前行批量：install=true → 非 on 的全装（已 on 清 pending）；false → on 的全卸。 */
export function rowAll(deps: SkillAgentKeyDeps, install: boolean): void {
  const rows = deps.rows()
  const cols = deps.columns()
  const matrix = deps.matrix
  const skill = rows[matrix.cursor().row]
  if (!skill) return
  const inst = deps.installations()
  for (const col of cols) {
    if (!col.enabled) continue
    const base = baseCellKind(inst[installationKey(skill.name, col.id)], true)
    if (install) {
      if (base === "on") matrix.clearIntent(skill.name, col.id)
      else matrix.setIntent(skill.name, col.id, "install")
    } else {
      if (base === "on") matrix.setIntent(skill.name, col.id, "uninstall")
      else matrix.clearIntent(skill.name, col.id)
    }
  }
}
