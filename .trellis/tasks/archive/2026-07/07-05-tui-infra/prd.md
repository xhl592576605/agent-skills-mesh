# TUI: 框架迁移 + 基础设施（child-1 of tui-redesign）

> 父 task：`07-05-tui-redesign`（见 `prd.md` + `design.md`）。本 task 实施 `implement.md` 的 **Phase 1 + 2**。

## Goal

完成从 Ink/React 到 **@opentui/solid + Bun** 的迁移，搭建 TUI 基础设施（theme / context / dialog / app 入口），使 `asm tui` 能启动显示骨架。这是其它三个 child task 的基础。

## Dependencies

- **无**（基础 task，child-2/3/4 都依赖本 task）

## Scope（父 design.md §2/§3/§4/§5/§7/§8）

- **依赖迁移**：移除 `ink`/`react`/`@types/react`/`ink-testing-library`/`tsx`；加 `@opentui/core`/`@opentui/solid`/`@opentui/keymap`/`solid-js`。
- **scripts/tsconfig**：`dev` → `bun run`；`build` → standalone（child-4 完整）；`jsxImportSource: "@opentui/solid"`。
- **theme**（`src/tui/theme/index.ts`）：效果图黄绿蓝风格（design §8，黄高亮+绿状态+蓝链接）。
- **context**：`theme.tsx`（ThemeProvider）、`data.tsx`（DataProvider 加载 config/index，复用 ConfigStore/IndexStore/refreshIndex）、`dialog.tsx`（DialogProvider 弹窗栈，移植 opencode `src/ui/dialog.tsx`）。
- **dialogs**：`Dialog.tsx`（position absolute + zIndex + RGBA 遮罩）、`ConfirmDialog.tsx`（`show(): Promise<boolean>`）。
- **index.tsx + App.tsx**：`index.tsx` 导出 run() + `render(() => <App/>)`；`App.tsx` Provider 装配 + TabBar 占位 + StatusBar 占位。（⚠️ APFS 大小写不敏感，不能同时有 app.tsx 和 App.tsx，故用 index.tsx + App.tsx）
- **CLI 接线**：`src/cli/index.ts` tui command 懒加载 `run()`，保留 isTTY 检测。
- 旧 `src/tui/**` 暂保留（child-4 删）。

## Requirements

- R1 框架迁移、R2 运行时迁移（父 R1/R2）
- R5 弹窗（DialogProvider + ConfirmDialog 部分）
- R7 主题（效果图风格）

## Acceptance Criteria

- [ ] `pnpm install` 成功，`@opentui/core` native 二进制装好（darwin-arm64）
- [ ] `bun run src/cli/index.ts tui` 启动，显示 TabBar（`[1 Skill×Agent][2 Source][3 Doctor]`）+ 空白视图
- [ ] `ESC` 退出 TUI；`1`/`2`/`3` 切 tab 占位
- [ ] `ConfirmDialog` 可弹出（absolute + zIndex + 半透明遮罩）、ESC/遮罩点击/ctrl+c 关闭、确认/取消返回 Promise<boolean>
- [ ] core 层（`src/core/**`）零改动
- [ ] `pnpm typecheck` 对 core/cli 绿
- [ ] **CLI 兼容性（已基线验证）**：迁移后所有现有 CLI 命令（`--help`/`init`/`refresh`/`source list`/`skill search`/`doctor`）在 `bun run src/cli/index.ts` 下行为不变。基线：bun 1.3.13 下 commander + core 已实测完整工作（`source list` 列出 sources、`doctor` 跑完 5 项检查）。**唯一允许的 cli 改动**：`tui` command 的懒加载 import 从 `react`/`ink`/`App.js` 换成 `../tui/index.js` 的 `run()`。`src/core/**` 零改动。

## Notes

- 弹窗模式参考 opencode `src/ui/dialog.tsx`（移植到 Solid）。
- bin 分发（standalone）在 child-4；本 task 只用 `bun run` 开发。
