# Implement — CLI/TUI bug 批量修复（bug 1-5）

> 执行计划。主会话 inline 实现（用户选定单任务一次性修）。每 R 一个独立提交单元，按风险从低到高排序。

## 实现顺序与依赖

```
R2（对齐·纯函数）→ R1（语义，复用 R2 的 renderTable 展示）
                → R5（agent，独立 core/cli/tui）
                → R4（多选+md，独立 tui）
                → R3（粘贴，依赖 renderer API 探针，风险隔离放最后）
```
R2 先做：最低风险、铺好纯函数 + 测试基线。R3 最后做：需实测终端。

## 步骤清单

### R2 — CLI 对齐
- [ ] 新增 `src/cli/columns.ts`（charWidth/strWidth/padEnd/truncate/renderTable，CJK 感知）
- [ ] 改写 `src/cli/skill-format.ts` `formatSkillRows`（表头 + 列宽，复用 renderTable）
- [ ] 改 `src/cli/index.ts`：source list / source update 输出走 renderTable
- [ ] 新增 `tests/cli/columns.test.ts`（CJK 宽度、截断、padEnd、renderTable）
- [ ] 更新 `tests/cli/skill-format.test.ts`（新格式 + 表头）

### R1 — skill list 语义
- [ ] `src/core/services/skill-service.ts` 新增 `listInstalledSkills(state, index)` 纯函数
- [ ] `src/cli/index.ts` skill list 改用 listInstalledSkills；空结果文案
- [ ] `src/tui/views/SkillAgentView.tsx` `allSkills()` 改为 state.installedSkills
- [ ] 更新 `tests/tui/matrix.test.ts` 等 fixture（行 = installed）
- [ ] 新增 `listInstalledSkills` 单测

### R5 — agent 智能启用
- [ ] `config-store.ts` 新增 `agentDetectPath` + `detectAgentInstalled`；`init()` 首次/force 时探测
- [ ] 新增 `src/core/services/agent-service.ts`（listAgents / setAgentEnabled）
- [ ] `src/cli/index.ts` 新增 `agent` 命令组（list/enable/disable），输出 renderTable
- [ ] `projection.ts` `buildAgentColumns` 加 `includeDisabled` 选项
- [ ] `SkillAgentView.tsx` 加 `showDisabled` signal + `A` 切换键 + Inspector 启停入口（E/X）
- [ ] 单测：detectAgentInstalled、agent-service、buildAgentColumns 过滤

### R4 — source 多选 + SKILL.md
- [ ] 新增 `src/tui/dialogs/MultiSelectDialog.tsx`
- [ ] 新增 `src/tui/dialogs/SkillMdDialog.tsx`（Markdown + ScrollBox）
- [ ] `SourceView.tsx` `doDetail` 重写（多选 + 批量 add + inspect → SkillMd）
- [ ] 更新 `tests/tui/dialog.test.ts`（MultiSelectDialog 键位）
- [ ] 手动验证批量 add 部分失败汇总

### R3 — TUI 粘贴
- [ ] 探针：确认 `useRenderer()` → paste 监听确切 API（一次性脚本打印 renderer 结构）
- [ ] `PromptDialog.tsx` onMount 注册 paste 监听 + onCleanup 注销
- [ ] 粘贴文本过滤控制字符（保留可打印 + unicode）
- [ ] 手动验证 cmd+v 粘贴含空格 url；记录验证结果

## 验证命令

```bash
bun run typecheck          # tsc --noEmit
bun run test               # vitest run
bun run src/cli/index.ts skill list      # 人工
bun run src/cli/index.ts agent list      # 人工
bun run src/cli/index.ts tui             # 人工：matrix / source / add source 粘贴
```

## Review 门（task.py start 前）

- [ ] prd.md / design.md / implement.md 完整且经用户 review
- [ ] implement.jsonl / check.jsonl 已 curate 真实 spec 条目（非 _example）
- [ ] 无阻断性 Open Question

## 实现期回滚点

每个 R 完成后单独 commit（标题 `fix(cli/tui): Rn <简述>`），任一 R 出现无法快速解决的回归即 revert 该 R，其余不受影响。
