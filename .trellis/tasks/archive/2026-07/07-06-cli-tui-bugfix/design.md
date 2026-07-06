# Design — CLI/TUI bug 批量修复（bug 1-5）

> 配套 `prd.md`。i18n（bug6）不在本批。本设计遵循 `.trellis/spec/frontend`（component / solid-patterns / state-management / quality / type-safety）与 `.trellis/spec/backend`。

## 1. 架构与边界

改动按三层分布，互不耦合，可独立提交/回滚：

| 层 | 文件 | 涉及 R |
|---|---|---|
| core | `storage/config-store.ts`、新增 `services/agent-service.ts`、`services/skill-service.ts`(+纯函数) | R1, R5 |
| cli | `cli/index.ts`、`cli/skill-format.ts`、新增 `cli/columns.ts` | R1, R2, R5 |
| tui | `dialogs/PromptDialog.tsx`、新增 `dialogs/MultiSelectDialog.tsx`、新增 `dialogs/SkillMdDialog.tsx`、`views/SourceView.tsx`、`views/SkillAgentView.tsx`、`state/projection.ts`（+`Inspector.tsx` 启停入口） | R1, R3, R4, R5 |

原则：core 保持「无 UI 依赖、纯函数可测」；CLI 输出走纯函数；TUI 复用 opentui 原生组件（`<Markdown>`/`<ScrollBox>`）而非自造。

## 2. R1 — skill list 语义

**core** — `skill-service.ts` 新增纯函数：
```ts
export interface InstalledSkillRow {
  name: string; status: SkillStatus; sourceId?: string;
  agents: string[]; description?: string;
}
export function listInstalledSkills(state: StateFile, index: IndexFile): InstalledSkillRow[]
```
从 `state.installedSkills` 投影，关联 `index.skills[name]` 取 status/description；`agents = Object.keys(record.enabledAgents)`；`sourceId` 取 `record.source.kind === "configured-source"` 时的 `sourceId`。

**cli** — `skill list` 改用 `listInstalledSkills(state, index)`；`skill search` 不变。空结果文案：「No skills added yet. Run `asm skill search` then `asm skill add <name>`.」

**tui** — `SkillAgentView.allSkills()` 改为从 `state.installedSkills` 取 name、回查 `index.skills[name]` 排序；matrix 单元格仍用 `index.installations`。从候选 add 的入口收归 Source tab（R4）。

**回归点** — `tests/tui/matrix.test.ts`、`source-keys` 相关 fixture 需改用 installed fixture。

## 3. R2 — CLI 对齐

**新增 `src/cli/columns.ts`**（纯函数）：
```ts
export function charWidth(ch: string): number          // CJK/全角→2，余→1
export function strWidth(s: string): number
export function padEnd(s: string, width: number): string
export function truncate(s: string, width: number): string   // 尾 …，按显示宽度
export function renderTable(headers: string[], rows: string[][], widths?: number[]): string[]
```
CJK 双宽判定用简版 wcwidth：U+1100-115F、U+2E80-A4CF、U+AC00-D7A3、U+F900-FAFF、U+FE10-FE6F、U+FF00-FF60、U+1F300-1FAFF → 2；其余 → 1。不引第三方依赖。

**改写 `formatSkillRows`** — 表头 `NAME / STATUS / SOURCE / AGENTS / DESCRIPTION` + 分隔线；列宽 NAME 22 / STATUS 10 / SOURCE 14 / AGENTS 18 / DESC 剩余截断。

**source list / source update** — 同样走 `renderTable`（id/type/enabled/path 或 sourceId/action/status/updatable）。

before/after（bug2 直观对比）：
```
[before · tab 分隔，跳列错位]
foo	managed	a short desc
longer-skill-name	conflict	a much longer description text
x	discovered

[after · 固定列宽 + 表头 + 截断]
NAME                 STATUS     SOURCE         AGENTS            DESCRIPTION
foo                  managed    repo           claude, codex     a short desc
longer-skill-na…     conflict   folder         —                 a much longer descript…
x                    discovered repo           —
```

## 4. R3 — TUI 粘贴

`PromptDialog.tsx` 增强（不动字符捕获主路径）：
```ts
const renderer = useRenderer()
onMount(() => {
  const onPaste = (e: PasteEvent) => {
    const text = new TextDecoder("utf8").decode(e.bytes).replace(/[\x00-\x1f\x7f]/g, "")
    if (text) setValue(v => v + text)
  }
  const hub = renderer.keyHandler ?? renderer
  hub.on("paste", onPaste)
  onCleanup(() => hub.off("paste", onPaste))
})
```
保留 `useKeyboard` 逐字输入；return/backspace/esc 不变。

**实现时验证** — `CliRenderer` 暴露 paste 的确切 API（`renderer.keyHandler.on('paste')` vs `renderer.on('paste')`）。若均不暴露，回退方案是改用 `<input>` 组件（最后选择；需 spec `solid-patterns.md` 记录的 owner-context pitfall 兜底）。

## 5. R4 — source 多选 + SKILL.md

**新增 `src/tui/dialogs/MultiSelectDialog.tsx`**（基于 `Dialog`）：
```ts
export interface MultiSelectOption<T> {
  label: string; value: T; description?: string; checked?: boolean; locked?: boolean
}
// 返回：{ selected: T[] }（return）；{ inspect: T }（按 i，不关闭）；undefined（esc）
MultiSelectDialog.show<T>(dialog, title, options): Promise<{ selected: T[] } | undefined>
```
键位：`↑↓/kj` 移动、`space` 切换勾选（locked 项前缀 `[✓]` 不可勾选）、`i` 触发 inspect 回调（弹 md）、`return` 提交已勾选、esc 取消。

**`SourceView.doDetail` 重写**：
- 选项 = source 贡献的 skills（`index.skills` 过滤 `candidates.sourceId === src.id`），按 name 排序；
- `locked` = 该 name 在 `state.installedSkills` 中；
- `return` → 对 `selected` 逐个 `skillAdd`，try/catch 捕获错误，StatusBar 汇总 `added a,b · failed: c (reason)`；
- `inspect` → 弹 `SkillMdDialog`。

**新增 `src/tui/dialogs/SkillMdDialog.tsx`** — 读 `resolveSourceSkillDir(source, candidate.relativePath)/SKILL.md`（installed 时读 `ssotPath/SKILL.md`），`<ScrollBox>` 包 `<Markdown>` 渲染；`j/k`/`↑↓` 滚动、esc 关闭。

**复用** — 批量 add 复用 `skillAdd`；md 读复用现有 fs 读取（与 `readSkillMetadata` 同源）。

## 6. R5 — agent 智能启用

**core/config-store.ts**：
```ts
export function agentDetectPath(agent: AgentConfig): string          // skills_dir 去 /skills 尾的父目录
export async function detectAgentInstalled(agent: AgentConfig): Promise<boolean>  // pathExists(父目录)
```
`init()`：首次创建或 `--force` 时，对 `createDefaultConfig().agents` 逐个 `detectAgentInstalled` → 改写 `enabled`。

**新增 `src/core/services/agent-service.ts`**：
```ts
listAgents(config): { id: string; agent: AgentConfig; installed: boolean }[]
setAgentEnabled(configStore: ConfigStore, id: string, enabled: boolean): Promise<void>
```

**cli** — 新增 `agent` 命令组（`list` / `enable <id>` / `disable <id>`），输出走 `renderTable`（id / name / installed / enabled / skills_dir）。

**tui/projection.ts**：
```ts
buildAgentColumns(agents, opts?: { includeDisabled?: boolean }): AgentColumn[]
```
默认过滤 `!enabled`；`SkillAgentView` 新增 `showDisabled` signal，键 `A` 切换；列变化时 `matrix.realign`。

**TUI 启停入口** — 最小改法：Inspector 选中行时键 `E`/`X` 启停当前列对应 agent（复用 `setAgentEnabled` + `ConfirmDialog` + reload）。

## 7. 兼容性 / 迁移

- 已有 config（非 force）不动 `enabled`；用户主动 `init --force` 或 `agent enable/disable` 调整。
- `skill list` 语义变化是用户可见行为变更，需在 commit/README 说明。
- matrix 行变 installed 后，未 add 的候选不再出现在 Skill×Agent tab，改由 Source tab 的 R4 入口 add。

## 8. 风险与回滚

| 风险 | 应对 |
|---|---|
| R3 renderer paste API 不确定 | 实现首步先写探针确认 API；失败回退 `<input>` 组件 |
| R1 破坏现有 matrix 测试 | 同步更新 fixture，projection 纯函数测试保持不变 |
| R5 init 探测误判（自定义 skills_dir） | 探测只影响默认值；用户可手动 enable；`agent list` 可复核 |
| 批量 add 部分失败污染 state | 每个 `skillAdd` 独立 try/catch，失败跳过不中断后续 |

每个 R 独立 commit，可单独 revert。
