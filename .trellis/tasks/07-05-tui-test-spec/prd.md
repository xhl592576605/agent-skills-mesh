# TUI: 测试 + spec + standalone 构建（child-4 of tui-redesign）

> 父 task：`07-05-tui-redesign`（见 `prd.md` + `design.md`）。本 task 实施 `implement.md` 的 **Phase 5 + 6 + 7**。

## Goal

为新 TUI（@opentui/solid）新写测试覆盖旧 5 类行为（matrix/discover/doctor/install-plan/reducer，旧 `tests/tui/**` 已在 child-1 删除）、更新 frontend spec、搭建 **standalone 构建链**，使 asm 可 npm 发布。

## Dependencies

- **child-1（07-05-tui-infra）**
- **child-2（07-05-tui-matrix）**
- **child-3（07-05-tui-views）**

## Scope（父 design.md §10/§2 bin）

- **Phase 5 测试**：测试工具封装（`testRender` + `captureCharFrame` + `mockInput.pressEnter/pressEscape`）；按 design §10 行为分类**新写** Matrix/弹窗/写操作链/Doctor/state 测试（覆盖旧 5 文件 47 cases 的行为：matrix 7/discover 6/doctor 3/reducer 26/use-install-plan 5）。注：旧 `tests/tui/**` 已在 child-1 删除，`vitest.config.ts` 已无 TUI exclude。
- **Phase 6 spec**：frontend 6 篇（directory-structure / component-guidelines / hook-guidelines→solid-patterns / state-management / type-safety / quality-guidelines / index）从 Ink/React 改写为 SolidJS + opentui。
- **Phase 7 收尾**：standalone 构建链；smoke；非 TTY 降级。（旧 `src/tui/**` + 旧测试已在 child-1 阶段删除，本 task 不再含删旧代码）

## Requirements

- R8 测试重写
- R9 spec 更新
- bin 分发（standalone exe 模式，父 design §2）

## Acceptance Criteria

- [ ] ~~`vitest.config.ts` 不再 exclude TUI~~（✅ child-1 已完成）
- [ ] 按 design §10 行为分类**新写** TUI 测试并通过（matrix 渲染/光标/toggle/批量、弹窗 confirm/esc/遮罩、写操作链 pending→plan→apply、Doctor issues/修复、state store 操作）
- [ ] frontend spec 6 篇改写为 SolidJS + opentui：`grep -wiE "ink|react\.dom|@types/react|createElement|reactElement" .trellis/spec/frontend/` 无残留
- [ ] **spec 事实性校验**（review 维度 8）：`index.md`/`directory-structure.md` 中关于 `src/tui/**` 存在性、package.json 依赖列表的陈述与现实一致（旧 spec 已失实：曾称"no tui dir"实际 15 文件、"no react/ink"实际有、"cac"实际是 commander）
- [ ] ~~删除旧 `src/tui/**`（Ink/React）+ 旧 TUI 测试文件~~（✅ child-1 阶段已完成）
- [ ] `scripts/build-standalone.ts`：为每平台 `bun build --compile` 产 standalone exe（含 opentui native + bun runtime）
- [ ] 平台包结构：`agent-skills-mesh-{platform}-{arch}`（6+ 平台：darwin-arm64/x64、linux-x64/arm64 + musl、win-x64）各含 standalone exe
- [ ] `bin/asm.js` wrapper：检测平台 → exec 对应平台包 exe（~30 行）
- [ ] 主包 `optionalDependencies` 声明所有平台包
- [ ] `pnpm typecheck` + `pnpm test` 全绿
- [ ] smoke：`asm init`(跳过)/`refresh`/`tui` 全流程 + 非 TTY 降级（`echo "" | asm tui` 打印提示）

## Notes

- standalone 构建：先 `bun install --os="*" --cpu="*" @opentui/core`，再每平台 `Bun.build({compile:{target,outfile}})`，Linux musl 用 `define:{"process.env.OPENTUI_LIBC":"\"musl\""}`。参考 opentui `docs/reference/standalone-executables` + opencode 分发模式（主包 wrapper + 平台 optionalDeps）。
- 测试映射见父 design §10。
