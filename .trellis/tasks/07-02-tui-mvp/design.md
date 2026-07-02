# Agent Skills Mesh TUI MVP — Technical Design

## 架构与边界

分层严格遵循 `.trellis/spec/frontend/**`：TUI 只做渲染与意图收集，域行为留在 `src/core/services/**`。

```txt
asm tui (cli/index.ts)
  ↓ 启动
src/tui/App.tsx              顶层路由 + 全局状态容器 + 数据加载
  ↓
screens/                     三屏，每屏消费 hooks + 纯展示组件
  MatrixScreen / DiscoverScreen / DoctorScreen
  ↓
hooks/                       封装 service 调用与本地状态
  useIndexState / useMatrixPending / useInstallPlan / useDiscover / useDoctor
  ↓
src/core/services/**         复用现有 + 新增（repair / search）
src/core/storage/**          ConfigStore / IndexStore 读写
```

硬约束（来自 spec，不可违反）：
- 组件 props 复用 `SkillRecord`、`InstallationRecord`、`InstallPlan`、`DoctorCheck`、`DiscoverEntry`，readonly。
- 文件系统变更必须 `buildXxxPlan` → 用户确认 → `applyXxxPlan` → `refreshIndex`。
- 终端安全文本，不依赖单一颜色（符号 + 文字双重编码）。
- 测试用 `ASM_HOME` 临时目录，Vitest + `ink-testing-library`。

## 目录结构

```txt
src/tui/
  App.tsx
  state/
    types.ts            PendingOp、TuiSnapshot 等本地状态类型
    reducer.ts          useReducer 的 reducer（屏切换、pending 累积、apply 结果）
  screens/
    MatrixScreen.tsx
    DiscoverScreen.tsx
    DoctorScreen.tsx
  components/
    Layout.tsx          顶部 tab（Matrix/Discover/Doctor）+ 底部帮助行 + 状态栏
    Matrix.tsx          Skill×Agent 表格（纯展示，受控）
    PlanReviewModal.tsx pending plan 聚合 review + 确认
    SkillInspector.tsx  选中 skill 的 candidates / status 详情
    StatusBar.tsx
  hooks/
    useIndexState.ts    加载 config+index、refresh、reload
    useInstallPlan.ts   build/apply install & uninstall（批量）
    useDiscover.ts      listDiscover / adoptSkill / setIgnored
    useDoctor.ts        runDoctor / applyFix（按 fix.type 调度）
    useTuiApp.ts        顶层 reducer 装配（.ts，无 JSX）
```

`.tsx` 仅用于返回 JSX 的模块；`reducer.ts`/`useTuiApp.ts`/`state/types.ts` 用 `.ts`。

## 状态机与数据流（pending plan 流）

复用 design.md 的状态机，落到 Matrix 屏幕：

```txt
启动: LoadSnapshot (ConfigStore + IndexStore；index 缺失则先 refreshIndex)
  → Idle (Matrix 默认屏)
Matrix: EditingMatrix (标记 pending) 
  → [enter] PendingPlan (聚合所有 pending 的 build plan)
  → ReviewPlan (展示 actions + conflicts)
  → [y] Applying (逐条 apply；hasConflict 项跳过并记录)
  → RefreshIndex (refreshIndex + store 写回)
  → EditingMatrix (矩阵重算)
  → [n/esc] 回到 EditingMatrix (pending 保留或清空，见下)
```

- `pending` 本地结构：`Map<skillName, Map<agentId, "install" | "uninstall">>`，存于 reducer state。
- `a / d` 行快捷键：对该 skill 的所有 **enabled** agent 批量写入 install / uninstall 意图（disabled agent 标记会被 review 阶段的 conflict 拦截）。
- review 取消（n/esc）：保留 pending，回到矩阵继续编辑（用户已确认批量心智）。
- apply 失败策略：symlink 操作原子，失败多为已被 plan 标 conflict；apply 阶段对 `hasConflict` plan 跳过，结束后在 StatusBar 汇总「N applied / M skipped(conflict)」，不中断。

## 屏幕设计

### Matrix
- 列：enabled agents（claude/codex/pi/gemini，按 config.agents 顺序，disabled 灰显并标 ×）。
- 行：`Object.values(index.skills)`，按 name 排序。
- 单元格符号：`✓ installed / ○ available / × unsupported / ! conflict / ~ pending`，pending 时用 `~` 叠加意图箭头（`~+` 装 / `~-` 卸）。
- 光标 `(row, col)`，方向键移动；`space` toggle 当前格（installed→uninstall 意图、available→install 意图，再次取消）。
- `enter` → PlanReviewModal。

### Discover
- 数据：`listDiscover(index)`。
- 列表项：kind badge + skillName + path；`a` adopt、`i` ignore、`u` unignore、`enter` 跳转到 Matrix 并定位该 skill（设置 Matrix 选中行 + 切屏）。

### Doctor
- 数据：`runDoctor(configStore, indexStore, config, index)`。
- 列表项：status 色 + kind + message；带 `fix` 的项显示 `[f] fix`。
- `f` 对选中项 applyFix；批量 `F` 一键修复所有可修复项（均经 review modal 二次确认）。

## 新增 / 变更的 service 层契约

### 1. `DoctorCheck` 扩展（破坏性，但仅内部消费）

```ts
// src/core/services/doctor-service.ts
export interface DoctorFix {
  type: "refresh-index" | "mkdir-agent-dir" | "repair-broken-link";
  skillName?: string;   // repair-broken-link 用
  agentId?: string;     // repair-broken-link / mkdir-agent-dir 用
  targetPath?: string;  // mkdir / repair 用
}
export interface DoctorCheck {
  status: "ok" | "warning" | "error";
  kind: string;
  message: string;
  fix?: DoctorFix;      // 存在则该检查项可一键修复
}
```

`runDoctor` 在生成以下检查项时附带 `fix`：
- index missing → `{ type: "refresh-index" }`
- agent skills_dir missing → `{ type: "mkdir-agent-dir", agentId, targetPath }`
- broken-link installation → `{ type: "repair-broken-link", skillName, agentId, targetPath }`

「哪些可修复」的知识留在 service 层，UI 只按 `fix.type` 调度。

### 2. 新增 repair plan（install-service.ts）

```ts
export interface RepairPlan {
  id: string;
  skillName: string;
  agentId: string;
  targetPath: string;
  newTarget: string;     // preferred candidate path
  hasConflict: boolean;
  warnings: string[];
}
export async function buildRepairPlan(config: AppConfig, index: IndexFile, skillName: string, agentId: string): Promise<RepairPlan>;
export async function applyRepairPlan(plan: RepairPlan): Promise<void>;
// apply: fs.unlink(targetPath) → fs.symlink(newTarget, targetPath, "dir")
```

design.md 预留的 `repair-broken-link` action 类型保留为内部表示；为减少类型面，repair 独立 `RepairPlan`（不塞进 `InstallAction` 联合，避免改动现有 plan 语义）。

### 3. 新增 search（skill-service.ts）

```ts
export function searchSkills(index: IndexFile, keyword: string): SkillRecord[];
// 按 name / displayName / description / tags 子串匹配（大小写不敏感），空 keyword 返回全部
```

CLI 侧 `asm skill search <keyword>` 复用此函数。

## 全局状态容器

MVP **不引入状态库**。用 `useReducer` 在 `App.tsx` 持有：

```ts
interface TuiState {
  snapshot: { config: AppConfig; index: IndexFile } | null;
  activeScreen: "matrix" | "discover" | "doctor";
  matrixCursor: { row: number; col: number };
  pending: Map<string, Map<string, "install" | "uninstall">>;
  focusSkill: string | null;     // Discover→Matrix 跳转定位
  busy: boolean;                 // apply / refresh 进行中
  lastResult: { applied: number; skipped: number } | null;
}
```

reducer 纯函数，可单测。副作用（service 调用）放在 hooks 的 effect/handler 里，不进 reducer。

## 依赖选型

| 包 | 版本 | 用途 |
|---|---|---|
| `ink` | ^5 | TUI 渲染（成熟稳定，ESM） |
| `react` | ^18 | Ink 对等依赖 |
| `ink-testing-library` | ^4 (dev) | 组件渲染单测 |
| `@types/react` | ^18 (dev) | 类型 |

不引入 zustand/redux（MVP 用 useReducer）。Ink 5 + React 18 是文档与 testing-library 兼容性最好的组合；Ink 6/React 19 较新，MVP 不冒险。

`asm tui` 在 `src/cli/index.ts` 用 `cli.command("tui", ...)` 注册；TUI 入口用动态 `import("../tui/App.js")` 懒加载，避免 CLI 常用命令承担 React 打包开销（tsx 运行时按需加载）。

## 测试策略

- **service 层**（repair / search / doctor-fix）：纯函数 + 临时目录，沿用 `tests/install-service.test.ts` 模式。
- **reducer**：纯函数单测（pending toggle、行批量、apply 结果归并）。
- **组件**：`ink-testing-library` 渲染 Matrix/PlanReviewModal，模拟 keypress 断言符号与 pending。
- **集成**：`ASM_HOME=/tmp/...` 跑 `asm tui` 启动 + 一次 install pending → apply → refresh 的端到端（render 模式）。
- 禁止对真实 `~/.pi/agent/skills` 等目录操作。

## 安全 / 回滚

- 所有写操作经 plan；apply 前用户必须在 PlanReviewModal 确认。
- `applyRepairPlan` 的 unlink 仅对 `lstat.isSymbolicLink()` 的目标执行，真实目录拒绝（与 uninstall 一致）。
- refresh 后 store 原子写（已有 `index-store` 保证）。
- 回滚点：先落 service 层（repair/search/doctor-fix）并测透，再上 TUI；若 Ink 状态复杂，Matrix 先只读渲染、再加交互。

## Trade-offs

- **DoctorCheck 加 fix 字段**：轻微破坏性，但无外部消费者；换来 UI 不重复「哪些可修」判断逻辑。
- **RepairPlan 独立类型**：不动现有 `InstallAction` 联合，避免影响 install/uninstall 语义，代价是多一个类型。
- **useReducer 而非状态库**：MVP 状态面有限，零依赖；若后续 Discover/Doctor 交互膨胀再评估。
- **Ink 5 而非 6**：稳定优先，testing-library 兼容好。

## Open Questions（技术细节，实现时定）

- pending 在 review 取消后是否保留：默认保留（见状态机）。
- Discover 跳转 Matrix 后 focusSkill 是否清屏选中：设为 Matrix 选中行 + 高亮。
- 大量 skill 时 Matrix 虚拟化：MVP 不做（skill 数量预期 <200），超过再引入 `ink-table`/虚拟列表。
