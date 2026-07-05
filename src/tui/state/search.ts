import { createSignal } from "solid-js"
import type { SkillRecord } from "../../core/models/skill.js"

/**
 * 搜索状态（design §3 `state/search.ts`）。
 *
 * `query` 为当前过滤词，`active` 表示 SearchBar 是否处于输入态（独占键盘收字符）。
 * 过滤为纯函数（不持状态），供 view 在响应式上下文调用。
 */
export interface SearchState {
  query: () => string
  setQuery: (q: string) => void
  active: () => boolean
  setActive: (v: boolean) => void
  /** 进入搜索态并清空过滤词（`/` 触发）。 */
  enter: () => void
  /** 退出搜索态；clearQuery=true 时同时清空过滤词（ESC），否则保留过滤（return）。 */
  exit: (clearQuery?: boolean) => void
}

export function createSearchState(): SearchState {
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(false)
  return {
    query,
    setQuery,
    active,
    setActive,
    enter() {
      setQuery("")
      setActive(true)
    },
    exit(clearQuery = false) {
      setActive(false)
      if (clearQuery) setQuery("")
    }
  }
}

/**
 * 按 name / displayName / description / tags 做大小写无关 includes 过滤。
 *
 * 不引入 fuzzysort 以保持依赖最小（prd 允许简单 includes）。query 为空时返回全部（复制一份保证调用方可变排序）。
 */
export function filterSkills(skills: readonly SkillRecord[], query: string): SkillRecord[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...skills]
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.displayName.toLowerCase().includes(q) ||
      (s.description ?? "").toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
  )
}
