/**
 * skills.sh 搜索弹窗状态机纯逻辑测试（implement.md 阶段 5 验证点）。
 *
 * 覆盖：2 字符阈值、300ms 防抖、连续输入取最新 query、query 变化立即清结果/分页/cursor
 * 并失效旧请求、A/B 乱序只接受最新 requestId、abort 不进 error、错误进 error（含可手动添加
 * 提示 code）、↑/↓ clamp、空结果 Enter 无动作、已安装 Enter 阻止+notice、←/→ 本地翻页边界、
 * dispose 后迟到 Promise 不写 state。
 *
 * 策略：注入 search mock（controllable promise）+ fake timers，绝不访问网络/OpenTUI FFI。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildSkillsShDetailUrls,
  createSkillsShSearchState,
  nextSkillsShDetailLink,
  SKILLS_SH_DEBOUNCE_MS,
} from "../../src/tui/state/skills-sh-search.js"
import type {
  SearchSkillsShOptions,
  SkillsShSearchResult,
  SkillsShSkillRef,
} from "../../src/core/services/skills-sh-service.js"

// === fixtures ===

/** 构造合法 SkillsShSkillRef（owner/repo 严格两段）。 */
function ref(skillId: string, source = "owner/repo", name?: string, installs = 5): SkillsShSkillRef {
  const [owner, repo] = source.split("/")
  return {
    provider: "skills.sh",
    id: `id-${skillId}`,
    skillId,
    name: name ?? skillId,
    installs,
    source,
    repository: {
      owner,
      repo,
      key: `github:${owner.toLowerCase()}/${repo.toLowerCase()}`,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
    },
  }
}

function resultOf(items: SkillsShSkillRef[]): SkillsShSearchResult {
  return { query: "q", searchType: "semantic", items, returnedCount: items.length, durationMs: 1 }
}

/** 带 code 的 Error（模拟 bizError 结构，state 不依赖 core/errors）。 */
function codedError(code: string, message = code): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

interface MockSearch {
  search: (opts: SearchSkillsShOptions) => Promise<SkillsShSearchResult>
  calls: { query: string; signal?: AbortSignal }[]
  resolveAt: (i: number, r: SkillsShSearchResult) => void
  rejectAt: (i: number, e: unknown) => void
  callCount: () => number
}

/** 构造可控 search mock：每次调用 push 一个 resolver/rejecter；可选 signal abort 时自动 reject AbortError（模拟真实 searchSkillsSh）。 */
function makeMockSearch(autoRejectOnAbort = true): MockSearch {
  const calls: { query: string; signal?: AbortSignal }[] = []
  const resolvers: Array<(r: SkillsShSearchResult) => void> = []
  const rejecters: Array<(e: unknown) => void> = []
  const search = (opts: SearchSkillsShOptions): Promise<SkillsShSearchResult> =>
    new Promise((resolve, reject) => {
      calls.push({ query: opts.query, signal: opts.signal })
      resolvers.push(resolve)
      rejecters.push(reject)
      if (autoRejectOnAbort) {
        opts.signal?.addEventListener("abort", () => {
          const e = new Error("aborted")
          e.name = "AbortError"
          reject(e)
        })
      }
    })
  return {
    search,
    calls,
    resolveAt: (i, r) => resolvers[i](r),
    rejectAt: (i, e) => rejecters[i](e),
    callCount: () => calls.length,
  }
}

function createState(mock: MockSearch, installed: Set<string>): ReturnType<typeof createSkillsShSearchState> {
  return createSkillsShSearchState({
    search: mock.search,
    isInstalled: (id: string) => installed.has(id),
  })
}

/** flush microtasks（promise then/catch 链）。 */
function flush(): Promise<void> {
  return vi.advanceTimersByTimeAsync(0)
}

describe("skills-sh-search state", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // === R1: 2 字符阈值 ===
  describe("2 字符阈值", () => {
    it("trim 后少于 2 字符不发起请求（idle）", () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      expect(mock.callCount()).toBe(0)
      expect(s.phase()).toBe("idle")
    })

    it("第 2 个字符进入 debouncing 但未请求", () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      expect(s.phase()).toBe("debouncing")
      expect(mock.callCount()).toBe(0)
    })
  })

  // === R1: 300ms 防抖 ===
  describe("300ms 防抖", () => {
    it(`debounce 常量 = ${SKILLS_SH_DEBOUNCE_MS}ms`, () => {
      expect(SKILLS_SH_DEBOUNCE_MS).toBe(300)
    })

    it("299ms 不请求，300ms 请求一次", async () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(299)
      expect(mock.callCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(1)
      expect(mock.callCount()).toBe(1)
      expect(mock.calls[0].query).toBe("ab")
      expect(s.phase()).toBe("loading")
    })

    it("连续输入只请求最后一次 query（debounce 重置）", async () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(200)
      s.appendChar("c")
      await vi.advanceTimersByTimeAsync(200)
      s.appendChar("d") // "abcd"
      await vi.advanceTimersByTimeAsync(300)
      expect(mock.callCount()).toBe(1)
      expect(mock.calls[0].query).toBe("abcd")
    })

    it("backspace 删尾并重新防抖", async () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      s.appendChar("c")
      await vi.advanceTimersByTimeAsync(300)
      expect(mock.calls[0].query).toBe("abc")
      s.backspace() // "ab"
      await vi.advanceTimersByTimeAsync(300)
      expect(mock.callCount()).toBe(2)
      expect(mock.calls[1].query).toBe("ab")
    })
  })

  // === 竞态：query 变化立即清结果/分页/cursor 并失效旧请求 ===
  describe("query 变化立即清状态", () => {
    it("得到结果后再输入新字符，立即清 items/page/cursor", async () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      mock.resolveAt(0, resultOf([ref("foo"), ref("bar")]))
      await flush()
      expect(s.phase()).toBe("ready")
      expect(s.items()).toHaveLength(2)
      s.moveCursor(1)
      expect(s.cursor()).toBe(1)
      // 输入新字符 → 立即清
      s.appendChar("c")
      expect(s.items()).toHaveLength(0)
      expect(s.page()).toBe(0)
      expect(s.cursor()).toBe(0)
      expect(s.phase()).toBe("debouncing")
    })
  })

  describe("乱序响应：旧请求不覆盖新查询", () => {
    it("requestId 兜底：fetch 不响应 abort 时，旧 resolve 后到达也不覆盖", async () => {
      // 不自动 abort reject，模拟 fetch 忽略 abort。
      const mock = makeMockSearch(false)
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b") // "ab"
      await vi.advanceTimersByTimeAsync(300)
      // A(calls[0]) pending
      s.appendChar("c") // "abc" → 新 requestId，A 不被 reject（mock 不 abort reject）
      await vi.advanceTimersByTimeAsync(300)
      // B(calls[1]) pending
      expect(mock.callCount()).toBe(2)
      // 先 resolve B（新）
      mock.resolveAt(1, resultOf([ref("new")]))
      await flush()
      expect(s.items().map((i) => i.skillId)).toEqual(["new"])
      // 后 resolve A（旧）—— 不覆盖
      mock.resolveAt(0, resultOf([ref("old")]))
      await flush()
      expect(s.items().map((i) => i.skillId)).toEqual(["new"])
    })

    it("B 后完成、A 后完成，最终只展示 B", async () => {
      const mock = makeMockSearch(false)
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      s.appendChar("c")
      await vi.advanceTimersByTimeAsync(300)
      mock.resolveAt(0, resultOf([ref("A1"), ref("A2")])) // A 旧
      mock.resolveAt(1, resultOf([ref("B1")])) // B 新
      await flush()
      expect(s.items().map((i) => i.skillId)).toEqual(["B1"])
    })
  })

  // === abort 不进 error ===
  describe("abort 静默", () => {
    it("query 变化使旧请求 abort，旧 reject AbortError 不进 error", async () => {
      const mock = makeMockSearch(true)
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300) // A loading
      expect(s.phase()).toBe("loading")
      s.appendChar("c") // abort A
      await flush() // A 的 abort reject 走 catch（myId!==requestId 丢弃）
      expect(s.phase()).not.toBe("error")
      expect(s.error()).toBeUndefined()
    })
  })

  // === 错误进 error（含可手动添加提示 code） ===
  describe("错误状态", () => {
    it("search 抛带 code 错误 → phase=error，error().code 保留（供 Dialog 翻译为含手动添加提示）", async () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      // SKILLS_SH_UNAVAILABLE 字典已含「可按 a 手动添加」提示。
      mock.rejectAt(0, codedError("SKILLS_SH_UNAVAILABLE", "timeout"))
      await flush()
      expect(s.phase()).toBe("error")
      expect((s.error() as { code?: string }).code).toBe("SKILLS_SH_UNAVAILABLE")
    })

    it("非 Error reject 也进 error", async () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      mock.rejectAt(0, "string error")
      await flush()
      expect(s.phase()).toBe("error")
      expect(s.error()).toBeInstanceOf(Error)
    })

    it("error 后再次有效输入重新发起请求并恢复", async () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      mock.rejectAt(0, codedError("SKILLS_SH_INVALID_RESPONSE"))
      await flush()
      expect(s.phase()).toBe("error")
      s.appendChar("c") // "abc"
      expect(s.phase()).toBe("debouncing")
      await vi.advanceTimersByTimeAsync(300)
      mock.resolveAt(1, resultOf([ref("ok")]))
      await flush()
      expect(s.phase()).toBe("ready")
    })
  })

  // === ↑/↓ clamp ===
  describe("光标移动 clamp", () => {
    it("moveCursor clamp 到 [0, pageItems.length-1]", async () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      mock.resolveAt(0, resultOf([ref("a"), ref("b"), ref("c")]))
      await flush()
      s.moveCursor(10)
      expect(s.cursor()).toBe(2)
      s.moveCursor(-100)
      expect(s.cursor()).toBe(0)
    })

    it("空结果时光标移动无动作", async () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      mock.resolveAt(0, resultOf([]))
      await flush()
      s.moveCursor(1)
      expect(s.cursor()).toBe(0)
    })
  })

  // === Enter 语义 ===
  describe("confirmSelect", () => {
    it("空结果 Enter 返回 null（无动作）", async () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      mock.resolveAt(0, resultOf([]))
      await flush()
      expect(s.confirmSelect()).toBeNull()
    })

    it("loading 期间 Enter 返回 null", async () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      expect(s.phase()).toBe("loading")
      expect(s.confirmSelect()).toBeNull()
    })

    it("debouncing 期间 Enter 返回 null", () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      expect(s.phase()).toBe("debouncing")
      expect(s.confirmSelect()).toBeNull()
    })

    it("已安装项 Enter 被阻止，置 notice=installed，返回 null", async () => {
      const mock = makeMockSearch()
      const installed = new Set(["foo"])
      const s = createState(mock, installed)
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      mock.resolveAt(0, resultOf([ref("foo")]))
      await flush()
      expect(s.notice()).toBe("")
      expect(s.confirmSelect()).toBeNull()
      expect(s.notice()).toBe("installed")
    })

    it("未安装项 Enter 返回该 ref", async () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      const r = ref("foo")
      mock.resolveAt(0, resultOf([r]))
      await flush()
      expect(s.confirmSelect()).toBe(r)
    })

    it("moveCursor 清 notice", async () => {
      const mock = makeMockSearch()
      const installed = new Set(["foo"])
      const s = createState(mock, installed)
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      mock.resolveAt(0, resultOf([ref("foo"), ref("bar")]))
      await flush()
      s.confirmSelect() // 置 notice installed（cursor 在 foo）
      expect(s.notice()).toBe("installed")
      s.moveCursor(1) // 移到 bar
      expect(s.notice()).toBe("")
    })
  })

  // === ←/→ 本地翻页边界 ===
  describe("本地分页", () => {
    it("每页 10 条，15 项 → 2 页；翻页重置 cursor", async () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      const items = Array.from({ length: 15 }, (_, i) => ref(`s${i}`))
      mock.resolveAt(0, resultOf(items))
      await flush()
      expect(s.totalPages()).toBe(2)
      expect(s.pageItems()).toHaveLength(10)
      expect(s.page()).toBe(0)
      // 边界：page 0 时 prevPage no-op
      s.prevPage()
      expect(s.page()).toBe(0)
      // 下一页
      s.nextPage()
      expect(s.page()).toBe(1)
      expect(s.pageItems()).toHaveLength(5)
      expect(s.cursor()).toBe(0) // 翻页重置 cursor
      // 边界：最后一页 nextPage no-op
      s.nextPage()
      expect(s.page()).toBe(1)
      // 上一页
      s.prevPage()
      expect(s.page()).toBe(0)
      expect(s.pageItems()).toHaveLength(10)
    })

    it("不足一页时 totalPages=1，翻页 no-op", async () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      mock.resolveAt(0, resultOf([ref("x")]))
      await flush()
      expect(s.totalPages()).toBe(1)
      s.nextPage()
      expect(s.page()).toBe(0)
      s.prevPage()
      expect(s.page()).toBe(0)
    })

    it("翻页清 notice", async () => {
      const mock = makeMockSearch()
      const installed = new Set(["s0"])
      const s = createState(mock, installed)
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      mock.resolveAt(0, resultOf(Array.from({ length: 15 }, (_, i) => ref(`s${i}`))))
      await flush()
      s.confirmSelect() // s0 installed → notice
      expect(s.notice()).toBe("installed")
      s.nextPage()
      expect(s.notice()).toBe("")
    })
  })

  describe("详情链接纯函数", () => {
    it("用 API id 构造官方 skills.sh 详情页，并用可信仓库坐标构造 GitHub URL", () => {
      const item = ref("skill-name", "Owner/Repo")
      item.id = "Owner/Repo/skill-name"
      expect(buildSkillsShDetailUrls(item)).toEqual({
        skillsSh: "https://www.skills.sh/Owner/Repo/skill-name",
        github: "https://github.com/Owner/Repo",
      })
    })

    it("逐段编码详情 id，并在两个链接间循环切换", () => {
      const item = ref("skill")
      item.id = "owner/repo/技能"
      expect(buildSkillsShDetailUrls(item).skillsSh).toBe(
        `https://www.skills.sh/owner/repo/${encodeURIComponent("技能")}`,
      )
      expect(nextSkillsShDetailLink("skillsSh")).toBe("github")
      expect(nextSkillsShDetailLink("github")).toBe("skillsSh")
    })
  })

  // === dispose 后迟到 Promise 不写 state ===
  describe("dispose", () => {
    it("dispose 后迟到 resolve 不写 state", async () => {
      const mock = makeMockSearch(false)
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      s.dispose()
      mock.resolveAt(0, resultOf([ref("late")]))
      await flush()
      expect(s.phase()).toBe("loading") // 未被 late resolve 覆盖
      expect(s.items()).toHaveLength(0)
    })

    it("dispose 后迟到 reject 不进 error", async () => {
      const mock = makeMockSearch(false)
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      await vi.advanceTimersByTimeAsync(300)
      s.dispose()
      mock.rejectAt(0, codedError("SKILLS_SH_UNAVAILABLE"))
      await flush()
      expect(s.phase()).not.toBe("error")
    })

    it("dispose 取消未到期的防抖 timer（不发起请求）", () => {
      const mock = makeMockSearch()
      const s = createState(mock, new Set())
      s.appendChar("a")
      s.appendChar("b")
      s.dispose()
      vi.advanceTimersByTime(SKILLS_SH_DEBOUNCE_MS)
      expect(mock.callCount()).toBe(0)
    })
  })
})
