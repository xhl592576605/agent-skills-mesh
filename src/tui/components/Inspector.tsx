import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { Theme } from "../theme/index.js"
import type { InstallationRecord } from "../../core/models/installation.js"
import type { SkillRecord } from "../../core/models/skill.js"
import type { MatrixState } from "../state/matrix.js"
import { type AgentColumn, cellInfo, installationKey } from "../state/projection.js"
import { type TranslateFn } from "../context/i18n.js"
import { Panel } from "./Panel.js"

export interface InspectorProps {
  skill: SkillRecord | undefined
  columns: readonly AgentColumn[]
  installations: Record<string, InstallationRecord>
  matrix: MatrixState
  theme: Theme
  t: TranslateFn
  /** 当前选中技能是否有源内容可更新到 SSOT。 */
  updatable?: boolean
}

export function Inspector(props: InspectorProps) {
  const theme = props.theme
  return (
    <Panel theme={theme} height={6} paddingLeft={1} paddingRight={1}>
      <Show
        when={props.skill}
        fallback={<text fg={theme.textMuted}>{props.t("inspector.noSkill")}</text>}
      >
        {(skill: () => SkillRecord) => (
          <box flexDirection="row" gap={1} flexGrow={1} alignItems="center">
            <box
              width={5}
              height={3}
              border={true}
              borderColor={theme.border}
              backgroundColor={theme.panelMuted}
              flexDirection="column"
              alignItems="center"
              justifyContent="center"
            >
              <text fg={theme.cyan} attributes={TextAttributes.BOLD}>›</text>
            </box>
            <box flexDirection="column" flexGrow={1}>
              <box flexDirection="row" gap={2}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  {skill().displayName || skill().name}
                </text>
                <Show when={props.updatable}>
                  <text fg={theme.danger}>* {props.t("skillDetail.updatable")}</text>
                </Show>
                <text fg={theme.textMuted}>{props.t("info.status")}: </text>
                <text fg={theme.primary}>{skill().status}</text>
                <text fg={theme.textMuted}> | {props.t("info.candidates")}: </text>
                <text fg={theme.primary}>{skill().candidates.length}</text>
              </box>
              <text fg={theme.textMuted} wrapMode="none">
                {skill().description?.slice(0, 120) ?? props.t("inspector.noDesc")}
              </text>
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
          </box>
        )}
      </Show>
    </Panel>
  )
}
