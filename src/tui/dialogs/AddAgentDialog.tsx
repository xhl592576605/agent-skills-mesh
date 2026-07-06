import type { DialogContextValue } from "../context/dialog.js"
import { PromptDialog } from "./PromptDialog.js"

/**
 * Add agent 表单弹窗（task 07-06-cli-tui-bugfix · R5+）。
 *
 * 串联 PromptDialog 收集 id + skills_dir（+ 可选 name），交给 `addAgent` 写 config。
 * 任一步 ESC / 空值视为取消，整体返回 undefined。与 AddSourceDialog 同款异步模式。
 */
export interface AddAgentInput {
  id: string
  skillsDir: string
  name?: string
}

export namespace AddAgentDialog {
  /**
   * 弹出 add agent 表单，返回输入或 undefined（用户取消）。
   * id / skillsDir 为空视为取消。
   */
  export async function show(dialog: DialogContextValue): Promise<AddAgentInput | undefined> {
    const id = await PromptDialog.show(dialog, "Add agent — id", "", "lowercase [a-z0-9-]")
    if (id === undefined || id.trim() === "") return undefined

    const skillsDir = await PromptDialog.show(dialog, "skills_dir", "", "agent skills dir (symlink target)")
    if (skillsDir === undefined || skillsDir.trim() === "") return undefined

    const name = await PromptDialog.show(dialog, "Name (optional)", "", "empty = use id")
    if (name === undefined) return undefined

    return { id: id.trim(), skillsDir: skillsDir.trim(), name: name.trim() || undefined }
  }
}
