import type { DialogContextValue } from "../context/dialog.js"
import { PromptDialog } from "./PromptDialog.js"
import { SelectDialog } from "./SelectDialog.js"
import type { AddSourceType } from "../../core/services/source-service.js"

/**
 * Source add 表单弹窗（design §9 `source add` 映射）。
 *
 * 串联三个弹窗收集输入（每个步骤可 ESC 取消，整体返回 undefined）：
 * 1. target（PromptDialog，必填，url 或本地路径）
 * 2. branch（PromptDialog，git repo 专用，空 = 默认分支）
 * 3. type（SelectDialog，auto 推断 / repo / folder / skill）
 *
 * 返回的 `type: undefined` 表示自动推断（传给 `addSource` 的 options.type=undefined）。
 */
export interface AddSourceInput {
  target: string
  /** 空字符串归一化为 undefined。 */
  branch?: string
  /** undefined = 自动推断（AddSourceType 仅在用户显式选择时给值）。 */
  type?: AddSourceType
}

export namespace AddSourceDialog {
  /**
   * 弹出 source add 表单，返回输入或 undefined（用户任一步骤取消）。
   * target 为空字符串视为取消（与 ESC 同语义，避免误提交空值）。
   */
  export async function show(dialog: DialogContextValue): Promise<AddSourceInput | undefined> {
    const target = await PromptDialog.show(dialog, "Add source — target", "", "url or local path")
    if (target === undefined || target.trim() === "") return undefined

    const branch = await PromptDialog.show(
      dialog,
      "Branch (git repo only)",
      "",
      "empty = default branch"
    )
    if (branch === undefined) return undefined

    const typeChoice = await SelectDialog.show(dialog, "Source type", [
      { label: "auto (infer)", value: "auto", description: "url→repo, SKILL.md dir→skill, …" },
      { label: "repo (git clone)", value: "repo" },
      { label: "folder (multi-skill dir)", value: "folder" },
      { label: "skill (single SKILL.md dir)", value: "skill" }
    ])
    if (typeChoice === undefined) return undefined

    return {
      target: target.trim(),
      branch: branch.trim() || undefined,
      type: typeChoice === "auto" ? undefined : (typeChoice as AddSourceType)
    }
  }
}
