# Design — TUI 样式重设计

## 1. 设计原则

本任务只重塑 TUI 的视觉层与布局组件，不改变 core 数据流与写操作流程。

- **Theme-first**：颜色、边框、选中态、keycap 都从 `src/tui/theme/index.ts` token 读取。
- **Presentational extraction**：把重复外观抽成轻量展示组件，避免三个 view 各自拼接不同风格。
- **Core-zero-change**：不修改 `src/core/**`。
- **Interaction-preserving**：按键路由仍由 `AppShell` + view handler 负责，组件只改展示。
- **Text redundancy**：颜色之外保留图标/文案/标签。

## 2. 目标组件结构

建议新增或调整以下 TUI 展示组件：

```txt
src/tui/components/
├── AppHeader.tsx        # 顶部产品名 + 右侧摘要
├── TabBar.tsx           # 图片风格 tab，含 active underline
├── Panel.tsx            # 通用边框面板，可复用在表格/详情卡
├── KeyHintBar.tsx       # 底部 keycap 提示栏
├── Matrix.tsx           # 保留纯渲染，改造成 bordered table + row index + selected bar
├── SearchBar.tsx        # 改造成目标图搜索框
├── Inspector.tsx        # 改造成 detail card
└── StatusBar.tsx        # 可被 KeyHintBar 替代或内部改为 keycap
```

也可以不新增全部文件，但实现上应形成这些边界：App header、TabBar、Panel、KeyHintBar、详情卡。

## 3. Theme token 扩展

在 `Theme` 中增加语义 token（命名可微调）：

- `backgroundAlt`：页面暗色渐层替代色/面板内底色。
- `panel` / `panelMuted`：主面板与 tab 背景。
- `border` / `borderStrong`：普通边框与 active 边框。
- `selection`：选中行深蓝背景。
- `selectionAccent`：选中行左侧亮蓝竖条。
- `keyBg` / `keyBorder`：底部 keycap 背景/边框。
- `cyan`：产品名与信息图标。

现有 token（`background`、`backgroundPanel`、`primary`、`success`、`warning`、`danger`、`accent`、`textMuted`）保持兼容，旧组件可逐步迁移。

## 4. AppShell 布局

当前 `src/tui/App.tsx` 内联 TabBar，需要改为：

```txt
┌──────────────────────────────────────────────┐
│ agent-skills-mesh                         摘要 │
│ [1 技能×智能体] [2 来源] [3 健康检查]         │
│ ──────────────────────────────────────────── │
│ 当前 View                                     │
│ 底部 keycap 提示栏                            │
└──────────────────────────────────────────────┘
```

数据摘要可在 AppShell 从 `data.snapshot` 派生：

- `total`：优先使用 `state.installedSkills` 数量；无 state 时回退 `index.skills` 数量。
- `errors` / `warnings`：使用 `index.issues` 的 severity 统计。
- Doctor 视图自身仍可在 view 内展示 `ok/warn/error` 细分；无需为了 header 改动 Doctor 数据流。

Tab 数据仍来自 i18n `tab.skill/source/doctor`。TabBar props：`tabs`、`active`、`theme`、`onSelect?`（如果未来鼠标支持）。本任务可只渲染，不接鼠标。

## 5. 表格设计

### 5.1 通用行样式

- 行号列宽 4-5，显示 `01`、`02`。
- 选中行：整行 `theme.selection` 背景；最左 1 字符 `theme.selectionAccent`。
- 表头：`theme.textMuted`，背景透明或 `theme.panelMuted`。
- 长文本：`wrapMode="none"`，必要时手动截断。

### 5.2 Matrix

`Matrix.tsx` 继续保持纯 render：props 不新增业务状态，只新增可选视觉参数。

建议列宽：

- 行号/选中条：4-5。
- skill name：28（窄屏时可缩到 20）。
- agent cell：12-18，按终端宽度计算更佳；MVP 可保留当前 9-12。

单元格标签沿用 `projection.ts`：`[on]`、`[off]`、`[+]`、`[-]`、`[!]`、`—`，避免影响 tests。

### 5.3 Source

SourceView 当前直接渲染行。改造时保持 view-local cursor 和 key handler 不变，只重写 JSX：

- 主表格包在 `Panel`。
- 行增加序号列和选中条。
- 路径与 `url/branch` 可用两行展示；如果 OpenTUI flex 高度处理复杂，MVP 可在同一行显示主路径，下一行用低亮文本追加。
- 详情卡读取 `selected()`，展示已有字段；不存在的 `updatedAt/defaultBranch` 不伪造。

### 5.4 Doctor

DoctorView 当前已持有 checks/cursor/message。改造时：

- 主表格包在 `Panel`。
- 行号列 + status icon/text + kind + message。
- `statusIcon(status)`：ok=`✓`，warning=`⚠`，error=`!` 或 `✕`；文本仍使用 `正常/警告/错误`。
- 详情卡读取 `selected()` 和 `check.fix`，展示修复建议。

## 6. SearchBar 与 KeyHintBar

### SearchBar

对齐 `skill.png`：

```txt
┌──────────────────────────────────────────────[/]┐
│ 🔍 搜索：（按 / 过滤技能）                       │
└─────────────────────────────────────────────────┘
```

终端字体对 emoji 宽度兼容性不稳定，可用 ASCII/Unicode 简化图标：`⌕` 或 `?`。右侧 `/` 以 keycap 样式渲染。

### KeyHintBar

现有 `StatusBar` 只 join 文本。改造为解析 hint 字符串或改 AppShell 传结构化 hint：

```ts
interface KeyHint { key: string; label: string }
```

为降低范围，MVP 可保留 `readonly string[]`，在 `StatusBar` 内按第一个空格拆分为 key + label；拆不开则原样显示。后续如需更精确再改 i18n 类型。

## 7. i18n 策略

- 复用现有 key；新增只在必要时加入 `src/i18n/zh-CN.ts` / `en.ts`。
- 状态文案优先使用已有 `status.enabled`、`doctor.statusOk` 等。
- Footer hints 当前由 i18n 提供整句（如 `space 切换`），MVP 可拆第一个空格；英文也能显示 keycap + label。

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| OpenTUI border/flex 在小终端下挤压 | 用 `flexGrow` + 固定局部高度，长文本 `wrapMode="none"` |
| keycap 拆分中英文不稳定 | 优先按首个空格拆分；不能拆则整段作为 label，不影响功能 |
| 详情卡占用过多高度导致表格行数少 | 视图内重新计算 viewport，优先保证至少 1 行 |
| 视觉改造影响键位 | 不改 `state/*-keys.ts`；测试覆盖 key routing |

## 9. 验证设计

- 静态：`pnpm typecheck`。
- 自动：`pnpm test`，重点确保 key-routing/matrix/source/dialog 纯逻辑未破坏。
- 手动：`bun run src/cli/index.ts tui`，逐一检查 Skill / Source / Doctor 三 tab：渲染、切换、退出、搜索或移动。
