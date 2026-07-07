import { describe, it, expect, vi } from "vitest"
import { RGBA } from "@opentui/core"
import { createMatrixState } from "../../src/tui/state/matrix.js"
import {
  baseCellKind,
  buildAgentColumns,
  cellColor,
  cellInfo,
  installationKey
} from "../../src/tui/state/projection.js"
import { createSearchState, filterSkills } from "../../src/tui/state/search.js"
import {
  createSkillAgentKeyHandler,
  type SkillAgentKeyDeps
} from "../../src/tui/state/skill-agent-keys.js"
import type { Theme } from "../../src/tui/theme/index.js"
import type { KeyEvent } from "@opentui/core"
import type { AgentConfig } from "../../src/core/models/config.js"
import type { InstallationRecord } from "../../src/core/models/installation.js"
import type { SkillRecord } from "../../src/core/models/skill.js"

/**
 * Matrix 纯逻辑测试（design §6/§4，固化为 vitest）。
 *
 * 覆盖 createMatrixState（cursor clamp/move/realign、pending set/clear/clearRow/clearAll）+
 * projection（列投影、单元格标签映射 `[on]/[off]/—/[!]/[+]/[-]`、颜色）+ search 过滤。
 * 不依赖 opentui 渲染，纯函数断言。
 */

const theme: Theme = {
  background: RGBA.fromHex("#0e1116"),
  backgroundPanel: RGBA.fromHex("#161b22"),
  text: RGBA.fromHex("#e6edf3"),
  textMuted: RGBA.fromHex("#7d8590"),
  primary: RGBA.fromHex("#58a6ff"),
  success: RGBA.fromHex("#3fb950"),
  warning: RGBA.fromHex("#d29922"),
  danger: RGBA.fromHex("#f85149"),
  accent: RGBA.fromHex("#79c0ff"),
  overlay: RGBA.fromInts(0, 0, 0, 150)
}

function makeSkill(name: string): SkillRecord {
  return {
    name,
    displayName: name,
    description: undefined,
    tags: [],
    status: "managed",
    candidates: []
  }
}

function makeInstallation(status: InstallationRecord["status"]): InstallationRecord {
  return {
    id: `i-${status}`,
    skillName: "s",
    agentId: "a",
    status,
    targetPath: "/tmp/t"
  }
}

describe("createMatrixState — cursor", () => {
  it("初始化 cursor={0,0}、scrollOffset=0、pending 为空", () => {
    const m = createMatrixState()
    expect(m.cursor()).toEqual({ row: 0, col: 0 })
    expect(m.scrollOffset()).toBe(0)
    expect(m.pending()).toEqual({})
    expect(m.hasPending()).toBe(false)
    expect(m.pendingCount()).toBe(0)
  })

  it("move 在范围内移动光标", () => {
    const m = createMatrixState()
    m.move(2, 1, 5, 3, 10)
    expect(m.cursor()).toEqual({ row: 2, col: 1 })
  })

  it("move 向上/左 clamp 到 0（不越界）", () => {
    const m = createMatrixState()
    m.move(-5, -5, 5, 3, 10)
    expect(m.cursor()).toEqual({ row: 0, col: 0 })
  })

  it("move 向下/右 clamp 到 rowCount-1 / colCount-1", () => {
    const m = createMatrixState()
    m.move(100, 100, 5, 3, 10)
    expect(m.cursor()).toEqual({ row: 4, col: 2 })
  })

  it("rowCount=0 时 move clamp 到 0（不 NaN）", () => {
    const m = createMatrixState()
    m.move(3, 1, 0, 0, 10)
    expect(m.cursor()).toEqual({ row: 0, col: 0 })
  })

  it("move 超过 viewport 时推进 scrollOffset", () => {
    const m = createMatrixState()
    // viewport=3，移动到 row 5 → scrollOffset 应为 5-3+1=3
    m.move(5, 0, 20, 3, 3)
    expect(m.cursor().row).toBe(5)
    expect(m.scrollOffset()).toBe(3)
  })

  it("move 回到窗口上方时回拉 scrollOffset", () => {
    const m = createMatrixState()
    m.move(5, 0, 20, 3, 3) // scrollOffset=3, cursor row=5
    m.move(-5, 0, 20, 3, 3) // cursor row=0 → scrollOffset 应回 0
    expect(m.cursor().row).toBe(0)
    expect(m.scrollOffset()).toBe(0)
  })

  it("realign 在行数收缩时 clamp cursor", () => {
    const m = createMatrixState()
    m.move(4, 0, 10, 3, 10) // row=4
    m.realign(2, 10) // 只剩 2 行 → clamp row=1
    expect(m.cursor().row).toBe(1)
  })
})

describe("createMatrixState — pending", () => {
  it("setIntent / intentFor 读写", () => {
    const m = createMatrixState()
    m.setIntent("skill-a", "claude", "install")
    expect(m.intentFor("skill-a", "claude")).toBe("install")
    expect(m.hasPending()).toBe(true)
    expect(m.pendingCount()).toBe(1)
  })

  it("多 skill / 多 agent 计数", () => {
    const m = createMatrixState()
    m.setIntent("s1", "claude", "install")
    m.setIntent("s1", "cursor", "uninstall")
    m.setIntent("s2", "claude", "install")
    expect(m.pendingCount()).toBe(3)
  })

  it("clearIntent 删除单个意图，空行自动清理", () => {
    const m = createMatrixState()
    m.setIntent("s1", "claude", "install")
    m.clearIntent("s1", "claude")
    expect(m.intentFor("s1", "claude")).toBeUndefined()
    expect(m.pending()["s1"]).toBeUndefined()
    expect(m.hasPending()).toBe(false)
  })

  it("clearIntent 不影响同 skill 其他 agent", () => {
    const m = createMatrixState()
    m.setIntent("s1", "claude", "install")
    m.setIntent("s1", "cursor", "uninstall")
    m.clearIntent("s1", "claude")
    expect(m.intentFor("s1", "cursor")).toBe("uninstall")
    expect(m.pendingCount()).toBe(1)
  })

  it("clearRow 删除整 skill 的所有意图", () => {
    const m = createMatrixState()
    m.setIntent("s1", "claude", "install")
    m.setIntent("s1", "cursor", "uninstall")
    m.setIntent("s2", "claude", "install")
    m.clearRow("s1")
    expect(m.pending()["s1"]).toBeUndefined()
    expect(m.intentFor("s2", "claude")).toBe("install")
    expect(m.pendingCount()).toBe(1)
  })

  it("clearAll 清空全部 pending", () => {
    const m = createMatrixState()
    m.setIntent("s1", "claude", "install")
    m.setIntent("s2", "cursor", "uninstall")
    m.clearAll()
    expect(m.pending()).toEqual({})
    expect(m.hasPending()).toBe(false)
  })

  it("覆盖已存在的 intent 更新值", () => {
    const m = createMatrixState()
    m.setIntent("s1", "claude", "install")
    m.setIntent("s1", "claude", "uninstall")
    expect(m.intentFor("s1", "claude")).toBe("uninstall")
    expect(m.pendingCount()).toBe(1)
  })
})

describe("projection — buildAgentColumns", () => {
  it("按 config 声明顺序投影列", () => {
    const agents: Record<string, AgentConfig> = {
      cursor: { name: "Cursor", enabled: true },
      claude: { name: "Claude", enabled: true },
      zed: { name: "Zed", enabled: false }
    }
    const cols = buildAgentColumns(agents)
    expect(cols.map((c) => c.id)).toEqual(["cursor", "claude", "zed"])
  })

  it("保留 disabled agent 列（enabled 字段透传）", () => {
    const cols = buildAgentColumns({ zed: { name: "Zed", enabled: false } })
    expect(cols[0].enabled).toBe(false)
  })

  it("name 缺失时回退到 id", () => {
    const cols = buildAgentColumns({ x: { name: "", enabled: true } })
    expect(cols[0].name).toBe("x")
  })
})

describe("projection — baseCellKind", () => {
  it("agent 禁用 → disabled", () => {
    expect(baseCellKind(undefined, false)).toBe("disabled")
  })

  it("无 installation → off", () => {
    expect(baseCellKind(undefined, true)).toBe("off")
  })

  it("installed → on", () => {
    expect(baseCellKind(makeInstallation("installed"), true)).toBe("on")
  })

  it("missing → off", () => {
    expect(baseCellKind(makeInstallation("missing"), true)).toBe("off")
  })

  it("broken-link / conflict / external → warning", () => {
    expect(baseCellKind(makeInstallation("broken-link"), true)).toBe("warning")
    expect(baseCellKind(makeInstallation("conflict"), true)).toBe("warning")
    expect(baseCellKind(makeInstallation("external"), true)).toBe("warning")
  })

  it("禁用 agent 即使 installed 也是 disabled", () => {
    expect(baseCellKind(makeInstallation("installed"), false)).toBe("disabled")
  })
})

describe("projection — cellInfo 标签映射", () => {
  it("基础标签：[on]/[off]/—/[!]", () => {
    expect(cellInfo(makeInstallation("installed"), true, undefined).label).toBe("[on]")
    expect(cellInfo(undefined, true, undefined).label).toBe("[off]")
    expect(cellInfo(undefined, false, undefined).label).toBe("—")
    expect(cellInfo(makeInstallation("conflict"), true, undefined).label).toBe("[!]")
  })

  it("pending install → [+] 覆盖原始状态", () => {
    expect(cellInfo(makeInstallation("installed"), true, "install").label).toBe("[+]")
    expect(cellInfo(undefined, true, "install").label).toBe("[+]")
  })

  it("pending uninstall → [-] 覆盖原始状态", () => {
    expect(cellInfo(makeInstallation("installed"), true, "uninstall").label).toBe("[-]")
  })

  it("kind 字段与 label 一致", () => {
    expect(cellInfo(undefined, true, "install").kind).toBe("pendingInstall")
    expect(cellInfo(undefined, true, "uninstall").kind).toBe("pendingUninstall")
    expect(cellInfo(makeInstallation("installed"), true, undefined).kind).toBe("on")
  })
})

describe("projection — cellColor", () => {
  it("on → success 绿", () => {
    expect(cellColor("on", theme)).toBe(theme.success)
  })
  it("warning → warning 黄", () => {
    expect(cellColor("warning", theme)).toBe(theme.warning)
  })
  it("pendingInstall → primary 高亮", () => {
    expect(cellColor("pendingInstall", theme)).toBe(theme.primary)
  })
  it("pendingUninstall → warning", () => {
    expect(cellColor("pendingUninstall", theme)).toBe(theme.warning)
  })
  it("off/disabled → textMuted 灰", () => {
    expect(cellColor("off", theme)).toBe(theme.textMuted)
    expect(cellColor("disabled", theme)).toBe(theme.textMuted)
  })
})

describe("projection — installationKey", () => {
  it("格式为 skillName:agentId", () => {
    expect(installationKey("my-skill", "claude")).toBe("my-skill:claude")
  })
})

describe("search — filterSkills", () => {
  it("空 query 返回全部（复制）", () => {
    const skills = [makeSkill("alpha"), makeSkill("beta")]
    const out = filterSkills(skills, "")
    expect(out).toHaveLength(2)
    // 返回副本，原数组不受影响
    expect(out).not.toBe(skills)
  })

  it("按 name includes 过滤（大小写无关）", () => {
    const skills = [makeSkill("Alpha"), makeSkill("beta")]
    expect(filterSkills(skills, "alp").map((s) => s.name)).toEqual(["Alpha"])
  })

  it("按 displayName / description / tags 过滤", () => {
    const s = makeSkill("x")
    s.displayName = "MyTool"
    const s2 = makeSkill("y")
    s2.description = "awesome helper"
    const s3 = makeSkill("z")
    s3.tags = ["lint"]
    const skills = [s, s2, s3]
    expect(filterSkills(skills, "tool").map((r) => r.name)).toEqual(["x"])
    expect(filterSkills(skills, "help").map((r) => r.name)).toEqual(["y"])
    expect(filterSkills(skills, "LINT").map((r) => r.name)).toEqual(["z"])
  })

  it("query 仅空白格视为空", () => {
    const skills = [makeSkill("alpha"), makeSkill("beta")]
    expect(filterSkills(skills, "   ")).toHaveLength(2)
  })
})

/** 构造最小 KeyEvent mock（createSkillAgentKeyHandler 只读 name/sequence/ctrl/meta）。 */
function key(name: string, opts: { sequence?: string; ctrl?: boolean; meta?: boolean } = {}): KeyEvent {
  return {
    name,
    sequence: opts.sequence ?? name,
    ctrl: opts.ctrl ?? false,
    meta: opts.meta ?? false,
    shift: false
  } as unknown as KeyEvent
}

/** 构造 handler 依赖（2 skill × 2 agent，全 enabled，无 installation）。 */
function makeHandlerDeps(overrides: Partial<SkillAgentKeyDeps> = {}): SkillAgentKeyDeps {
  const matrix = createMatrixState()
  const search = createSearchState()
  const skills = [makeSkill("skill-a"), makeSkill("skill-b")]
  const cols = [
    { id: "claude", enabled: true },
    { id: "cursor", enabled: true }
  ]
  return {
    matrix,
    search,
    rows: () => skills,
    columns: () => cols,
    installations: () => ({}),
    viewport: () => 10,
    onReview: vi.fn(),
    ...overrides
  }
}

describe("createSkillAgentKeyHandler — 非搜索态键路由", () => {
  it("方向键/hjkl 消费并移动光标", () => {
    const deps = makeHandlerDeps()
    const handler = createSkillAgentKeyHandler(deps)
    expect(handler(key("down"))).toBe(true)
    expect(deps.matrix.cursor()).toEqual({ row: 1, col: 0 })
    expect(handler(key("j"))).toBe(true)
    expect(handler(key("left"))).toBe(true)
    expect(handler(key("l"))).toBe(true)
    expect(handler(key("k"))).toBe(true)
    expect(deps.matrix.cursor().row).toBe(0)
  })

  it("space toggle 当前格（off→pending install）", () => {
    const deps = makeHandlerDeps()
    const handler = createSkillAgentKeyHandler(deps)
    expect(handler(key("space", { sequence: " " }))).toBe(true)
    expect(deps.matrix.intentFor("skill-a", "claude")).toBe("install")
  })

  it("a=行全装；d=删除当前 skill（触发 onDeleteSkill）", () => {
    const onDeleteSkill = vi.fn()
    const deps = makeHandlerDeps({ onDeleteSkill })
    const handler = createSkillAgentKeyHandler(deps)
    expect(handler(key("a"))).toBe(true)
    expect(deps.matrix.intentFor("skill-a", "claude")).toBe("install")
    expect(deps.matrix.intentFor("skill-a", "cursor")).toBe("install")
    expect(handler(key("d"))).toBe(true)
    expect(onDeleteSkill).toHaveBeenCalledWith("skill-a")
  })

  it("d 未注入 onDeleteSkill 时 fallthrough（返回 false）", () => {
    const deps = makeHandlerDeps()
    const handler = createSkillAgentKeyHandler(deps)
    expect(handler(key("d"))).toBe(false)
  })

  it("enter 触发 review（调用 onReview）", () => {
    const onReview = vi.fn()
    const deps = makeHandlerDeps({ onReview })
    const handler = createSkillAgentKeyHandler(deps)
    expect(handler(key("return"))).toBe(true)
    expect(onReview).toHaveBeenCalledOnce()
  })

  it("r 键已移除，fallthrough 给 AppShell（返回 false，不触发 review）", () => {
    const onReview = vi.fn()
    const deps = makeHandlerDeps({ onReview })
    const handler = createSkillAgentKeyHandler(deps)
    expect(handler(key("r"))).toBe(false)
    expect(onReview).not.toHaveBeenCalled()
  })

  it("**ctrl+r fallthrough 给 AppShell refresh**（enter 做审查，ctrl+r 不冲突）", () => {
    const onReview = vi.fn()
    const deps = makeHandlerDeps({ onReview })
    const handler = createSkillAgentKeyHandler(deps)
    expect(handler(key("r", { ctrl: true }))).toBe(false)
    expect(onReview).not.toHaveBeenCalled()
  })

  it("`/` 进入搜索态", () => {
    const deps = makeHandlerDeps()
    const handler = createSkillAgentKeyHandler(deps)
    expect(handler(key("/", { sequence: "/" }))).toBe(true)
    expect(deps.search.active()).toBe(true)
  })

  it("1/2/3/escape 交回 AppShell 全局键（返回 false）", () => {
    const deps = makeHandlerDeps()
    const handler = createSkillAgentKeyHandler(deps)
    expect(handler(key("1"))).toBe(false)
    expect(handler(key("2"))).toBe(false)
    expect(handler(key("3"))).toBe(false)
    expect(handler(key("escape"))).toBe(false)
  })
})

describe("createSkillAgentKeyHandler — 搜索态键路由", () => {
  it("可打印字符追加到 query 并消费（1/2/3 进搜索词，不切 tab）", () => {
    const deps = makeHandlerDeps()
    const handler = createSkillAgentKeyHandler(deps)
    handler(key("/", { sequence: "/" })) // 进搜索态
    expect(handler(key("1", { sequence: "1" }))).toBe(true)
    expect(handler(key("a", { sequence: "a" }))).toBe(true)
    expect(deps.search.query()).toBe("1a")
  })

  it("ctrl+r 在搜索态仍 fallthrough（不进词，交回 AppShell refresh）", () => {
    const deps = makeHandlerDeps()
    const handler = createSkillAgentKeyHandler(deps)
    handler(key("/", { sequence: "/" }))
    expect(handler(key("r", { ctrl: true }))).toBe(false)
    expect(deps.search.query()).toBe("")
  })

  it("escape 退出搜索并清词（消费）", () => {
    const deps = makeHandlerDeps()
    const handler = createSkillAgentKeyHandler(deps)
    handler(key("/", { sequence: "/" }))
    handler(key("x", { sequence: "x" }))
    expect(handler(key("escape"))).toBe(true)
    expect(deps.search.active()).toBe(false)
    expect(deps.search.query()).toBe("")
  })

  it("return 退出搜索保留词（消费）", () => {
    const deps = makeHandlerDeps()
    const handler = createSkillAgentKeyHandler(deps)
    handler(key("/", { sequence: "/" }))
    handler(key("x", { sequence: "x" }))
    expect(handler(key("return"))).toBe(true)
    expect(deps.search.active()).toBe(false)
    expect(deps.search.query()).toBe("x")
  })

  it("backspace 删尾（消费）", () => {
    const deps = makeHandlerDeps()
    const handler = createSkillAgentKeyHandler(deps)
    handler(key("/", { sequence: "/" }))
    handler(key("a", { sequence: "a" }))
    handler(key("b", { sequence: "b" }))
    expect(handler(key("backspace"))).toBe(true)
    expect(deps.search.query()).toBe("a")
  })

  it("搜索态下 Matrix 操作键（down/a/r）被当字符收下，不触发移动/review", () => {
    const onReview = vi.fn()
    const deps = makeHandlerDeps({ onReview })
    const handler = createSkillAgentKeyHandler(deps)
    handler(key("/", { sequence: "/" }))
    handler(key("d", { sequence: "d" }))
    handler(key("o", { sequence: "o" }))
    handler(key("w", { sequence: "w" }))
    handler(key("n", { sequence: "n" }))
    expect(deps.matrix.cursor()).toEqual({ row: 0, col: 0 }) // 未移动
    expect(onReview).not.toHaveBeenCalled()
    expect(deps.search.query()).toBe("down")
  })
})
