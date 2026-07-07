import type { DialogContextValue } from "../context/dialog.js"
import { PromptDialog } from "./PromptDialog.js"
import { t, type Locale } from "../../i18n/index.js"

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
  export async function show(dialog: DialogContextValue, locale: Locale): Promise<AddAgentInput | undefined> {
    const id = await PromptDialog.show(dialog, t("addAgent.titleId", locale), "", t("addAgent.placeholderId", locale))
    if (id === undefined || id.trim() === "") return undefined

    const skillsDir = await PromptDialog.show(dialog, t("addAgent.skillsDir", locale), "", t("addAgent.placeholderDir", locale))
    if (skillsDir === undefined || skillsDir.trim() === "") return undefined

    const name = await PromptDialog.show(dialog, t("addAgent.nameOptional", locale), "", t("addAgent.placeholderName", locale))
    if (name === undefined) return undefined

    return { id: id.trim(), skillsDir: skillsDir.trim(), name: name.trim() || undefined }
  }
}
