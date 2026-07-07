import type { DialogContextValue } from "../context/dialog.js"
import { PromptDialog } from "./PromptDialog.js"
import { t, type Locale } from "../../i18n/index.js"
import type { AddSourceType } from "../../core/services/source-service.js"

/**
 * Source add 表单弹窗（design §9 `source add` 映射）。
 *
 * 只问一个 target（git url 或本地路径）。type 由 `addSource` 自动推断
 * （url→repo / 含 SKILL.md 目录→skill / 多 skill 目录→folder）；repo 用默认分支，
 * 不再询问 branch。符合「source add 只需一个路径」的直觉。
 */
export interface AddSourceInput {
  target: string
  /** 空字符串归一化为 undefined。 */
  branch?: string
  /** undefined = 自动推断（AddSourceType 仅在显式指定时给值）。 */
  type?: AddSourceType
}

export namespace AddSourceDialog {
  /**
   * 弹出 source add 表单（单步：target），返回输入或 undefined（用户取消）。
   * target 为空视为取消（与 ESC 同语义，避免误提交空值）。
   * type / branch 留 undefined，交给 addSource 自动推断类型 + repo 默认分支。
   */
  export async function show(dialog: DialogContextValue, locale: Locale): Promise<AddSourceInput | undefined> {
    const target = await PromptDialog.show(dialog, t("addSource.title", locale), "", t("addSource.placeholder", locale))
    if (target === undefined || target.trim() === "") return undefined
    return { target: target.trim() }
  }
}
