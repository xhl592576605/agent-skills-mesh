import fs from "node:fs/promises"
import { TextAttributes } from "@opentui/core"
import { For, Show, createSignal, type ParentProps } from "solid-js"
import { useTheme } from "../context/theme.js"
import { useDialog, type DialogContextValue } from "../context/dialog.js"

/**
 * SKILL.md 正文查看弹窗（task 07-06-cli-tui-bugfix · R4）。
 *
 * 读取 SKILL.md 文件内容，在 `<scrollbox>` 内按行 `<text>` 渲染，支持滚动查看。
 *
 * 注：opentui `<markdown>` 组件需 `syntaxStyle`（依赖 tree-sitter 语法配置），本项目尚未
 * 引入该依赖，故暂用纯文本按行渲染；后续接入语法高亮时再升级为 `<markdown content={...} />`。
 * esc/ctrl+c/遮罩点击由 DialogProvider 统一关闭。
 */
export interface SkillMdDialogProps {
  title: string
  /** 已解析的 SKILL.md 绝对路径。 */
  skillMdPath: string
}

export function SkillMdDialog(props: ParentProps<SkillMdDialogProps>) {
  const theme = useTheme()
  const dialog = useDialog()
  const [content, setContent] = createSignal<string | undefined>(undefined)
  const [error, setError] = createSignal<string | undefined>(undefined)

  void (async () => {
    try {
      setContent(await fs.readFile(props.skillMdPath, "utf8"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  })()

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <Show when={!error()} fallback={<text fg={theme.danger}>Failed to read SKILL.md: {error()}</text>}>
        <Show when={content()} fallback={<text fg={theme.textMuted}>Loading...</text>}>
          <scrollbox height={20}>
            <For each={content()!.split("\n")}>
              {(line) => <text fg={theme.text} wrapMode="none">{line || " "}</text>}
            </For>
          </scrollbox>
        </Show>
      </Show>
      <text fg={theme.textMuted}>↑↓ scroll · esc close</text>
    </box>
  )
}

export namespace SkillMdDialog {
  /** 弹出 SKILL.md 正文（叠加在当前弹窗之上，用 push 不打断下层多选；esc 由 AppShell closeTop 回下层弹窗）。 */
  export function show(dialog: DialogContextValue, title: string, skillMdPath: string): void {
    dialog.push(() => <SkillMdDialog title={title} skillMdPath={skillMdPath} />)
  }
}
