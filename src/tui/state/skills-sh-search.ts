import { createSignal } from "solid-js"
import {
  SKILLS_SH_MIN_QUERY_LENGTH,
  type SearchSkillsShOptions,
  type SkillsShSearchResult,
  type SkillsShSkillRef,
} from "../../core/services/skills-sh-service.js"

/**
 * skills.sh 搜索弹窗的纯状态工厂（design §6.2，prd R1）。
 *
 * 只负责可测的交互/竞态/分页逻辑：phase 状态机、300ms 防抖、单调递增 `requestId`
 * （query 变化**立即**失效旧请求）、`AbortController` 取消、Top 50 本地每页 10 条分页、
 * cursor clamp、`installed` 仅作展示快照。实际网络请求由注入的 `search`（生产传
 * `searchSkillsSh`）完成，本模块不 import fetch / i18n，便于在 node vitest 用
 * fake timers + 注入 mock 直接断言（见 `tests/tui/skills-sh-search.test.ts`）。
 *
 * 竞态防护（prd AC1，硬约束）：公共端点忽略 offset，一次取 Top 50，本地分页；
 * 旧请求绝不能覆盖新查询 —— 既用 AbortController 取消，又用 `requestId` 双重兜底
 * （即便底层 fetch 不响应 abort，迟到响应的 then/catch 也按 `myId !== requestId` 丢弃）。
 *
 * abort 一律静默：无论主动 abort 还是新 query 触发的 abort，都不进入 `error` 状态。
 */

/** 搜索阶段。`debouncing`/`loading` 时 Enter 无效；输入仍可打断。 */
export type SkillsShSearchPhase =
  | "idle" // 初始 / query 少于 2 字符
  | "debouncing" // 已满 2 字符，等待 300ms
  | "loading" // 请求中
  | "ready" // 有可展示结果
  | "empty" // 无结果
  | "error" // 超时 / 非 2xx / 结构变化（abort 不算）

/** 选择反馈：installed 项被选时置 `installed`，其余动作清空。Dialog 翻译展示。 */
export type SkillsShNotice = "" | "installed"

export interface CreateSkillsShSearchStateOptions {
  /** 注入搜索（生产传 `searchSkillsSh`；测试传 mock）。接收 Core 的 SearchSkillsShOptions。 */
  search: (opts: SearchSkillsShOptions) => Promise<SkillsShSearchResult>
  /** 展示快照：判断 skillId 是否已安装（读 snapshot.state）。仅展示，非真相源。 */
  isInstalled: (skillId: string) => boolean
  /** 防抖毫秒，默认 300。 */
  debounceMs?: number
  /** 本地每页条数，默认 10。 */
  pageSize?: number
}

export interface SkillsShSearchState {
  phase: () => SkillsShSearchPhase
  query: () => string
  /** 全部过滤后的 Top 50。 */
  items: () => SkillsShSkillRef[]
  /** 当前页的 slice（pageSize 条）。 */
  pageItems: () => SkillsShSkillRef[]
  cursor: () => number
  page: () => number
  /** 总页数（至少 1，避免除零）。 */
  totalPages: () => number
  /** 最近一次失败（非 abort）。Dialog 用 errorMessage/formatError 翻译展示。 */
  error: () => Error | undefined
  notice: () => SkillsShNotice
  /** 追加可打印字符到 query（触发防抖）。 */
  appendChar: (ch: string) => void
  /** 删除末尾字符（触发防抖）。 */
  backspace: () => void
  /** 当前页内移动光标（clamp 到 [0, pageItems.length-1]），清 notice。 */
  moveCursor: (delta: number) => void
  /** 本地上一页（page>0 才翻），重置 cursor，清 notice；不走 debounce。 */
  prevPage: () => void
  /** 本地下一页（page<totalPages-1 才翻），重置 cursor，清 notice；不走 debounce。 */
  nextPage: () => void
  /**
   * Enter 选择当前项：
   * - loading/debouncing/空 → `null`
   * - 当前项已安装 → 置 notice=`installed`，返回 `null`
   * - 否则返回该 ref（调用方据此 resolve + clear）
   */
  confirmSelect: () => SkillsShSkillRef | null
  isInstalled: (skillId: string) => boolean
  /** 卸载/关闭清理：递增 requestId（让迟到 Promise 丢弃）、abort、清 timer。 */
  dispose: () => void
}

/** 默认防抖 300ms（research §5，MVP 固定常量）。 */
export const SKILLS_SH_DEBOUNCE_MS = 300
/** 本地每页 10 条（design §6.2，Top 50 内客户端分页）。 */
export const SKILLS_SH_PAGE_SIZE = 10

export type SkillsShDetailLink = "skillsSh" | "github"

export interface SkillsShDetailUrls {
  skillsSh: string
  github: string
}

/** 使用搜索响应 id 构造官方详情页，并由已校验仓库坐标构造 GitHub 页面。 */
export function buildSkillsShDetailUrls(ref: SkillsShSkillRef): SkillsShDetailUrls {
  const detailPath = ref.id.split("/").filter(Boolean).map(encodeURIComponent).join("/")
  const owner = encodeURIComponent(ref.repository.owner)
  const repo = encodeURIComponent(ref.repository.repo)
  return {
    skillsSh: `https://www.skills.sh/${detailPath}`,
    github: `https://github.com/${owner}/${repo}`,
  }
}

export function nextSkillsShDetailLink(current: SkillsShDetailLink): SkillsShDetailLink {
  return current === "skillsSh" ? "github" : "skillsSh"
}

export function createSkillsShSearchState(
  options: CreateSkillsShSearchStateOptions,
): SkillsShSearchState {
  const debounceMs = options.debounceMs ?? SKILLS_SH_DEBOUNCE_MS
  const pageSize = options.pageSize ?? SKILLS_SH_PAGE_SIZE
  const searchFn = options.search

  const [phase, setPhase] = createSignal<SkillsShSearchPhase>("idle")
  const [query, setQuery] = createSignal("")
  const [items, setItems] = createSignal<SkillsShSkillRef[]>([])
  const [cursor, setCursor] = createSignal(0)
  const [page, setPage] = createSignal(0)
  const [error, setError] = createSignal<Error | undefined>(undefined)
  const [notice, setNotice] = createSignal<SkillsShNotice>("")

  let timer: ReturnType<typeof setTimeout> | undefined
  /** 单调递增请求序号；query 变化时立即递增，使旧请求的 then/catch 丢弃。 */
  let requestId = 0
  let controller: AbortController | undefined

  const isInstalled = (skillId: string): boolean => options.isInstalled(skillId)

  const totalPages = (): number => Math.max(1, Math.ceil(items().length / pageSize))

  const pageItems = (): SkillsShSkillRef[] => {
    const start = page() * pageSize
    return items().slice(start, start + pageSize)
  }

  function resetPaging(): void {
    setPage(0)
    setCursor(0)
    setNotice("")
  }

  /**
   * query 变化的统一入口：立即失效旧请求（递增 requestId + abort + 清 timer），
   * 清结果/分页/cursor/notice/error，按 trim 长度决定 idle 或 debouncing。
   */
  function onQueryChange(nextQuery: string): void {
    // 关键：query 变化立即递增 requestId（不等新 debounce 到期），旧请求迟到即丢弃。
    requestId++
    controller?.abort()
    controller = undefined
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    setError(undefined)
    setNotice("")
    setQuery(nextQuery)
    setItems([])
    resetPaging()

    const trimmed = nextQuery.trim()
    if (trimmed.length < SKILLS_SH_MIN_QUERY_LENGTH) {
      setPhase("idle")
      return
    }
    setPhase("debouncing")
    const myId = requestId
    timer = setTimeout(() => {
      timer = undefined
      // debounce 窗口内 query 又变 → requestId 已递增，丢弃本次。
      if (myId !== requestId) return
      runSearch(trimmed, myId)
    }, debounceMs)
  }

  function runSearch(trimmedQuery: string, myId: number): void {
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    setPhase("loading")
    searchFn({ query: trimmedQuery, signal })
      .then((result) => {
        // 旧请求（query 已变 / 已 dispose）一律丢弃。
        if (myId !== requestId) return
        const next = result.items
        setItems(next)
        resetPaging()
        setPhase(next.length > 0 ? "ready" : "empty")
      })
      .catch((e: unknown) => {
        if (myId !== requestId) return // 旧请求
        // abort（主动取消 / 新 query 触发 / dispose）一律静默，不进 error。
        const aborted = signal.aborted || (e instanceof Error && e.name === "AbortError")
        if (aborted) return
        setError(e instanceof Error ? e : new Error(String(e)))
        setPhase("error")
      })
  }

  return {
    phase,
    query,
    items,
    pageItems,
    cursor,
    page,
    totalPages,
    error,
    notice,
    appendChar: (ch) => onQueryChange(query() + ch),
    backspace: () => onQueryChange(query().slice(0, -1)),
    moveCursor: (delta) => {
      const list = pageItems()
      if (list.length === 0) return
      setNotice("")
      const max = list.length - 1
      setCursor(Math.min(max, Math.max(0, cursor() + delta)))
    },
    prevPage: () => {
      if (page() <= 0) return
      setPage(page() - 1)
      setCursor(0)
      setNotice("")
    },
    nextPage: () => {
      if (page() >= totalPages() - 1) return
      setPage(page() + 1)
      setCursor(0)
      setNotice("")
    },
    confirmSelect: () => {
      // loading / debouncing 期间禁用 Enter。
      if (phase() === "loading" || phase() === "debouncing") return null
      const list = pageItems()
      const item = list[cursor()]
      if (!item) return null
      if (isInstalled(item.skillId)) {
        setNotice("installed")
        return null
      }
      return item
    },
    isInstalled,
    dispose: () => {
      // 递增 requestId：迟到 Promise 的 then/catch 全部丢弃，不写已卸载状态。
      requestId++
      controller?.abort()
      controller = undefined
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
    },
  }
}
