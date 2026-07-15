import { describe, expect, it, vi } from "vitest"
import { triggerInstalledOptionUpdate } from "../../src/tui/state/multi-select-actions.js"

describe("triggerInstalledOptionUpdate", () => {
  const options = [
    { value: "discovered" },
    { value: "installed", locked: true }
  ]

  it("已安装的勾选项可通过 u 触发更新", () => {
    const onUpdate = vi.fn()

    expect(triggerInstalledOptionUpdate(options, 1, onUpdate)).toBe(true)
    expect(onUpdate).toHaveBeenCalledWith("installed")
  })

  it("未安装项不触发更新", () => {
    const onUpdate = vi.fn()

    expect(triggerInstalledOptionUpdate(options, 0, onUpdate)).toBe(false)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
