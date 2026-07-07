import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { Theme } from "../theme/index.js"
import type { InstallationRecord } from "../../core/models/installation.js"
import type { SkillRecord } from "../../core/models/skill.js"
import type { MatrixState } from "../state/matrix.js"
import { type AgentColumn, cellInfo, installationKey } from "../state/projection.js"
import { type TranslateFn } from "../context/i18n.js"

/**
 * 选中 skill 的详情面板（design §6 Inspector）。
 *
 * 展示当前光标行的 skill：name/status/description/candidates 数量，以及每个 agent 的
 * 单元格状态标签（含 pending 意图），帮助用户在 apply 前确认写操作范围。
 */
export interface InspectorProps {
  skill: SkillRecord | undefined
  columns: readonly AgentColumn[]
  installations: Record<string, InstallationRecord>
  matrix: MatrixState
  theme: Theme
  t: TranslateFn
}

export function Inspector(props: InspectorProps) {
  const theme = props.theme
  return (
    <box
      border={["top"]}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
    >
      <Show
        when={props.skill}
        fallback={<text fg={theme.textMuted}>{props.t("inspector.noSkill")}</text>}
      >
        {(skill: () => SkillRecord) => (
          <box flexDirection="column" gap={0}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                {skill().displayName || skill().name}
              </text>
              <text fg={theme.textMuted}>
                {props.t("inspector.summary", { name: skill().name, status: skill().status, count: skill().candidates.length })}
              </text>
            </box>
            <box>
              <text fg={theme.textMuted}>
                {skill().description?.slice(0, 80) ?? props.t("inspector.noDesc")}
              </text>
            </box>
            <box flexDirection="row" gap={1}>
              <For each={props.columns}>
                {(col) => {
                  const info = () =>
                    cellInfo(
                      props.installations[installationKey(skill().name, col.id)],
                      col.enabled,
                      props.matrix.intentFor(skill().name, col.id)
                    )
                  return (
                    <box flexDirection="row">
                      <text fg={theme.textMuted}>{col.id}=</text>
                      <text fg={info().kind === "on" ? theme.success : theme.text}>
                        {info().label}
                      </text>
                    </box>
                  )
                }}
              </For>
            </box>
          </box>
        )}
      </Show>
    </box>
  )
}
