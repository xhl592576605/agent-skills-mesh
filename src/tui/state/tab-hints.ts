import type { TKey } from "../../i18n/index.js"

export type AppTab = "skill" | "source" | "doctor"

const TAB_HINT_KEYS: Record<AppTab, readonly TKey[]> = {
  skill: [
    "hint.move",
    "hint.toggle",
    "hint.rowOn",
    "hint.delete",
    "hint.update",
    "hint.updateAll",
    "hint.review",
    "hint.info",
    "hint.agents",
    "hint.search",
    "hint.help"
  ],
  source: [
    "hint.moveV",
    "hint.add",
    "hint.update",
    "hint.remove",
    "hint.enDis",
    "hint.detail",
    "hint.refresh",
    "hint.help",
    "hint.tabs"
  ],
  doctor: [
    "hint.moveV",
    "hint.fix",
    "hint.fixAll",
    "hint.refresh",
    "hint.help",
    "hint.tabs"
  ]
}

/** 返回当前 tab 的快捷键翻译 key，便于 AppShell 渲染与纯逻辑测试共用。 */
export function tabHintKeys(tab: AppTab): readonly TKey[] {
  return TAB_HINT_KEYS[tab]
}
