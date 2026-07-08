import { TextAttributes } from "@opentui/core"
import type { Theme } from "../theme/index.js"

export interface AppSummary {
  total: number
  errors: number
  warnings: number
  ok?: number
}

export interface AppHeaderProps {
  summary: AppSummary
  theme: Theme
  totalLabel: string
  errorLabel: string
  warningLabel: string
  okLabel: string
}

export function AppHeader(props: AppHeaderProps) {
  const theme = props.theme
  return (
    <box flexDirection="row" height={1} paddingLeft={1} paddingRight={1} backgroundColor={theme.backgroundAlt}>
      <box flexGrow={1} />
      <text fg={theme.textMuted}>{props.summary.total} {props.totalLabel}  |  </text>
      <ShowOk ok={props.summary.ok} theme={theme} label={props.okLabel} />
      <text fg={theme.danger} attributes={TextAttributes.BOLD}>{props.summary.errors} {props.errorLabel}</text>
      <text fg={theme.textMuted}>  |  </text>
      <text fg={theme.warning} attributes={TextAttributes.BOLD}>{props.summary.warnings} {props.warningLabel}</text>
    </box>
  )
}

function ShowOk(props: { ok: number | undefined; theme: Theme; label: string }) {
  if (props.ok === undefined) return undefined
  return (
    <box flexDirection="row">
      <text fg={props.theme.success} attributes={TextAttributes.BOLD}>{props.ok} {props.label}</text>
      <text fg={props.theme.textMuted}>  |  </text>
    </box>
  )
}
