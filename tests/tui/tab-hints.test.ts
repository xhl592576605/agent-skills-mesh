import { describe, expect, it } from "vitest"
import { tabHintKeys } from "../../src/tui/state/tab-hints.js"

describe("tabHintKeys", () => {
  it("技能页同时展示 u 单项更新与 U 全部更新快捷键", () => {
    expect(tabHintKeys("skill")).toContain("hint.update")
    expect(tabHintKeys("skill")).toContain("hint.updateAll")
  })

  it("各 tab 返回独立的快捷键集合", () => {
    expect(tabHintKeys("source")).toContain("hint.add")
    expect(tabHintKeys("doctor")).toContain("hint.fix")
  })
})
