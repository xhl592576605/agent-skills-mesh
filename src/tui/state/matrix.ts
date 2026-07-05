import { createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { Intent } from "./projection.js"

/**
 * Matrix 状态原语（design §4）。
 *
 * cursor（光标行列）+ pending（skillName→agentId→intent，写盘前的本地意图）+
 * scrollOffset（可见行窗口起点）。所有 FS 写操作发生在确认后经 core service，
 * 这里只维护 UI 态，符合「TUI 只收集意图」安全模型。
 *
 * 通过 `createMatrixState()` 工厂创建（每次 mount 独立实例，测试可隔离），
 * 由 SkillAgentView 持有；低级 set/clear 操作供 view 组合 toggle / 行批量语义。
 */
export interface Cursor {
  row: number
  col: number
}

/** pending 意图表：skillName → agentId → intent。 */
export type PendingMap = Record<string, Record<string, Intent>>

export interface MatrixState {
  cursor: () => Cursor
  pending: () => PendingMap
  scrollOffset: () => number

  /** 按增量移动光标并 clamp 到 [0,rowCount-1]×[0,colCount-1]，顺带调整 scrollOffset。 */
  move: (dr: number, dc: number, rowCount: number, colCount: number, viewport: number) => void
  setCursor: (row: number, col: number) => void
  /** 行/列数变化时 clamp cursor 与 scroll（搜索过滤、数据刷新后调用）。 */
  realign: (rowCount: number, viewport: number) => void

  intentFor: (skillName: string, agentId: string) => Intent | undefined
  setIntent: (skillName: string, agentId: string, intent: Intent) => void
  clearIntent: (skillName: string, agentId: string) => void
  clearRow: (skillName: string) => void
  clearAll: () => void

  pendingCount: () => number
  hasPending: () => boolean
}

export function createMatrixState(): MatrixState {
  const [cursor, setCursor] = createSignal<Cursor>({ row: 0, col: 0 })
  const [pending, setPending] = createStore<PendingMap>({})
  const [scrollOffset, setScrollOffset] = createSignal(0)

  const clamp = (v: number, max: number): number => (max <= 0 ? 0 : Math.max(0, Math.min(v, max)))

  /** 把 scrollOffset 调整到使 row 可见（row 在窗口内尽量不动）。 */
  function adjustScroll(row: number, rowCount: number, viewport: number): void {
    if (rowCount <= viewport) {
      setScrollOffset(0)
      return
    }
    let off = scrollOffset()
    if (row < off) off = row
    else if (row >= off + viewport) off = row - viewport + 1
    setScrollOffset(clamp(off, rowCount - viewport))
  }

  return {
    cursor,
    pending: () => pending,
    scrollOffset,

    move(dr, dc, rowCount, colCount, viewport) {
      const c = cursor()
      const nr = clamp(c.row + dr, rowCount - 1)
      const nc = clamp(c.col + dc, colCount - 1)
      setCursor({ row: nr, col: nc })
      adjustScroll(nr, rowCount, viewport)
    },
    setCursor(row, col) {
      setCursor({ row, col })
    },
    realign(rowCount, viewport) {
      const c = cursor()
      const row = clamp(c.row, rowCount - 1)
      if (row !== c.row) setCursor({ row, col: c.col })
      adjustScroll(row, rowCount, viewport)
    },

    // updater 形式：row 为当前 store[skillName]（不存在时 undefined），返回新对象赋给该键。
    // 比 `setPending(skillName, agentId, intent)` 两段路径更稳（不依赖自动创建嵌套，
    // server/client build 均支持，便于在非渲染上下文做纯逻辑测试）。
    intentFor(skillName, agentId) {
      return pending[skillName]?.[agentId]
    },
    setIntent(skillName, agentId, intent) {
      setPending(skillName, (row) => ({ ...(row ?? {}), [agentId]: intent }))
    },
    clearIntent(skillName, agentId) {
      setPending(
        produce((draft) => {
          const row = draft[skillName]
          if (!row) return
          delete row[agentId]
          if (Object.keys(row).length === 0) delete draft[skillName]
        })
      )
    },
    clearRow(skillName) {
      setPending(
        produce((draft) => {
          delete draft[skillName]
        })
      )
    },
    clearAll() {
      setPending(
        produce((draft) => {
          for (const k of Object.keys(draft)) delete draft[k]
        })
      )
    },

    pendingCount() {
      let n = 0
      for (const row of Object.values(pending)) n += Object.keys(row).length
      return n
    },
    hasPending() {
      return Object.keys(pending).length > 0
    }
  }
}
