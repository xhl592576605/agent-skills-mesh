import { useTerminalDimensions } from "@opentui/solid"
import type { MouseEvent } from "@opentui/core"
import type { ParentProps } from "solid-js"
import { useTheme } from "../context/theme.js"

/**
 * 基础浮层（design §7）。
 *
 * position="absolute" + zIndex=3000 捕获点击（onMouseUp→onClose）；
 * **不设背景色**：OpenTUI 0.4.x 的半透明 bg alpha 合成会破坏 CJK 双宽字符
 * （中文消失、英文保留），无法在应用层修复。改为透明覆盖，弹窗靠内层 panel
 * 的 borderStrong 边框 + backgroundPanel 底色与背景区分。内层 panel 居中。
 * 点击外层触发 `onClose`，点击内层 panel 通过 stopPropagation 不冒泡（避免误关）。
 */
export interface DialogProps {
  size?: "medium" | "large"
  onClose: () => void
}

export function Dialog(props: ParentProps<DialogProps>) {
  const dim = useTerminalDimensions()
  const theme = useTheme()
  const panelWidth = 92

  const stop = (event: MouseEvent) => {
    // 选中释放不应关闭弹窗（与 opencode 同款行为，Phase 2 暂不区分 selection）。
    event.stopPropagation()
  }

  return (
    <box
      width={dim().width}
      height={dim().height}
      alignItems="center"
      position="absolute"
      zIndex={3000}
      paddingTop={Math.floor(dim().height / 4)}
      left={0}
      top={0}
      onMouseUp={() => props.onClose()}
    >
      <box
        width={panelWidth}
        maxWidth={dim().width - 2}
        border={true}
        borderColor={theme.borderStrong}
        backgroundColor={theme.backgroundPanel}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
        onMouseUp={stop}
      >
        {props.children}
      </box>
    </box>
  )
}
