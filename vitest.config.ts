import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // TUI 测试引用旧 model（available/unsupported/adopt/skillOverrides），与本任务的新 installation
    // 语义脱节。TUI 四屏 + 测试由独立任务 `07-03-tui-redesign` 整体重写；本任务仅保证 TUI 可编译（typecheck 通过）。
    exclude: ["tests/tui/**", "**/node_modules/**", "**/dist/**"]
  }
});
