const UPDATE_MARKER_PLACEHOLDER = "  "

/** 名称列表头预留更新标记槽位，使表头与所有名称的起始列一致。 */
export function formatUpdateIndicatorHeader(header: string): string {
  return `${UPDATE_MARKER_PLACEHOLDER}${header}`
}

/** 固定宽度更新标记；无更新时保留等宽空槽，避免名称错位。 */
export function formatUpdateIndicatorName(
  name: string,
  updatable: boolean
): { marker: string; name: string; text: string } {
  const marker = updatable ? "* " : UPDATE_MARKER_PLACEHOLDER
  return { marker, name, text: `${marker}${name}` }
}
