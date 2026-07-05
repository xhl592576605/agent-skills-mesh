import { useTerminalDimensions } from "@opentui/solid"
import type { MouseEvent } from "@opentui/core"
import type { ParentProps } from "solid-js"
import { useTheme } from "../context/theme.js"

/**
 * 基础浮层（design §7）。
 *
 * position="absolute" + zIndex=3000 + RGBA 半透明遮罩铺满终端；
 * 内层 panel 居中、固定宽度、主题背景。点击外层遮罩触发 `onClose`，
 * 点击内层 panel 通过 stopPropagation 不冒泡（避免误关）。
 */
export interface DialogProps {
  size?: "medium" | "large"
  onClose: () => void
}

export function Dialog(props: ParentProps<DialogProps>) {
  const dim = useTerminalDimensions()
  const theme = useTheme()
  const panelWidth = props.size === "large" ? 80 : 56

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
      backgroundColor={theme.overlay}
      onMouseUp={() => props.onClose()}
    >
      <box
        width={panelWidth}
        maxWidth={dim().width - 2}
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
