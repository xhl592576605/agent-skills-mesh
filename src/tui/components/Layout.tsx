import { Box, Text } from "ink";
import type { ReactElement, ReactNode } from "react";
import type { TuiScreen } from "../state/types.js";

export interface LayoutProps {
  readonly activeScreen: TuiScreen;
  /** 当前屏的按键帮助行（上下文相关，由 App 按 activeScreen 提供）。 */
  readonly help: string;
  readonly children: ReactNode;
}

const TABS: ReadonlyArray<{ id: TuiScreen; label: string; key: string }> = [
  { id: "matrix", label: "Matrix", key: "1" },
  { id: "discover", label: "Discover", key: "2" },
  { id: "doctor", label: "Doctor", key: "3" }
];

/** 顶部 tab 栏（高亮当前屏）+ 子内容 + 底部按键帮助行。纯展示壳。 */
export function Layout({ activeScreen, help, children }: LayoutProps): ReactElement {
  return (
    <Box flexDirection="column">
      <Box>
        {TABS.map((tab, index) => (
          <Text key={tab.id} dimColor={tab.id !== activeScreen}>
            {index > 0 ? "  " : ""}
            {tab.id === activeScreen ? "[" : " "}
            {tab.label}
            <Text dimColor> [{tab.key}]</Text>
            {tab.id === activeScreen ? "]" : " "}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>keys: {help}</Text>
      </Box>
    </Box>
  );
}
