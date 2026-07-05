# Design — TUI 重设计（@opentui/solid + Bun）

> 配套 `prd.md`。本文记录技术设计：架构、目录、状态、组件、弹窗、主题、CLI 映射、测试、迁移、风险。

## 1. 架构概览

分层不变，只替换「UI 渲染 + 状态」两层：

```
┌─────────────────────────────────────────────┐
│  CLI (commander)   src/cli/index.ts         │  不变
├─────────────────────────────────────────────┤
│  core services     src/core/services/**     │  不变（复用，禁止重写域逻辑）
├─────────────────────────────────────────────┤
│  TUI 状态层        src/tui/state/**         │  重写：React reducer → Solid stores/signals
│  TUI 视图层        src/tui/{views,...}      │  重写：Ink/React → Solid + opentui
│  渲染后端          @opentui/solid + core    │  替换：Ink → opentui（native Zig）
└─────────────────────────────────────────────┘
```

**核心原则**：TUI 只做「渲染 + 收集意图」；所有 FS 写操作经 `buildInstallPlan`/`buildUninstallPlan`/repair plan（`src/core/services/install-service.ts`），UI 有 confirm 步骤。

## 2. 运行时与依赖迁移

### package.json 变更

| 动作 | 包 |
|---|---|
| 移除 | `ink`, `react`, `@types/react`, `ink-testing-library` |
| 移除 | `tsx`（dev 改 bun run） |
| 新增 | `@opentui/core`, `@opentui/solid`, `@opentui/keymap`（**锁 0.4.3**，Phase 0 实测）, `solid-js`（1.9.x） |
| 新增 dev | 可能 `@opentui/core/testing`（若独立入口） |
| 保留 | `commander`, `gray-matter`, `vitest`, `typescript` |

### scripts 变更

| 脚本 | 旧 | 新 |
|---|---|---|
| `dev` | `tsx src/cli/index.ts` | `bun run src/cli/index.ts` |
| `build` | `tsc` | 构建脚本为每平台 `bun build --compile` 产 standalone exe（见 bin 分发） |
| `test` | `vitest run` | `vitest run`（bun 兼容） |
| `typecheck` | `tsc --noEmit` | `tsc --noEmit` |

### tsconfig.json 变更（Phase 0 验证）

- `jsx`: **`"preserve"`**（**不是 react-jsx**！solid 需 preserve，由 bunfig preload 的 transform plugin 处理 JSX→响应式 getter）
- `jsxImportSource`: `"@opentui/solid"`
- 其余 NodeNext/strict 不变

### bunfig.toml（⚠️ Phase 0 验证的关键配置，解决 bun+solid JSX 转译）

```toml
preload = ["@opentui/solid/preload"]
```

preload 在 bun 启动时注册 solid transform plugin，把 JSX 表达式（如 `{count()}`）包成响应式 getter。**缺此配置，动态 signal 不会响应式更新**。Phase 0 动态 frame 实测：带 preload → frame 正确显示 `Count:3`（不是初始 0），`<box border>` 渲染正常。这是 solid 在 bun 下最著名的坑，**不可省略**。

### 版本锁定（Phase 0 实测）

- `@opentui/core`/`solid`/`keymap`: **0.4.3**（最新，已实测核心 API 全工作：`render`/`testRender`/`useKeyboard`/`useRenderer`/`useTerminalDimensions`/`box border`/`createTestRenderer`/`captureCharFrame`）。
- opencode catalog 锁 0.3.4，但 0.4.3 API 兼容（核心 API 全在）。**注意**：opencode 的 `Flag`/`useBindings`/`useOpencodeModeStack` 是 opencode 内部模块（非 @opentui API），移植 dialog 时只参考模式（`DialogProvider` 弹窗栈 + `await show()`），不照抄这些 import。

### bin 分发（npm 渠道，standalone executable 模式 — opencode 同款）

**调研修正（用户 #8）**：opencode 经 npm 分发且用户无需装 bun —— 机制是 `bun build --compile` 把 **bun runtime + opentui native + app 代码**编译成 standalone executable，每个平台一个 npm 包，主包经 `optionalDependencies` 按平台拉取（主包 `bin/opencode.exe` 仅 479B，是 wrapper 脚本）。asm 照搬此模式。

**架构**：

```
agent-skills-mesh (主 npm 包)
├── bin: { "asm": "bin/asm.js" }              # node wrapper（~30 行，检测平台 exec）
├── optionalDependencies:
│   ├── agent-skills-mesh-darwin-arm64
│   ├── agent-skills-mesh-darwin-x64
│   ├── agent-skills-mesh-linux-x64
│   ├── agent-skills-mesh-linux-arm64
│   ├── agent-skills-mesh-linux-x64-musl
│   └── agent-skills-mesh-win-x64
└── scripts/build-standalone.ts                # CI：为每平台 bun build --compile

agent-skills-mesh-{platform}-{arch} (平台包)
└── asm{.exe}                                  # standalone exe（自包含 bun+opentui+app）
```

**构建**（CI/release）：
1. `bun install --os="*" --cpu="*" @opentui/core@<ver>` 装全平台 native 包。
2. 每个 target：`Bun.build({ entrypoints:["src/cli/index.ts"], compile:{ target:"bun-{platform}-{arch}", outfile } })`；Linux musl 用 `define: {"process.env.OPENTUI_LIBC":"\"musl\""}`。
3. standalone exe 放进对应平台包，发布 npm。

**wrapper**（`bin/asm.js`，node 脚本，~30 行）：`process.platform`/`process.arch` 推导平台包名 → `require.resolve` 定位平台包里的 exe → `spawn(exePath, argv, {stdio:'inherit'})`；找不到则提示装对应平台包。

**用户体验**：`npm i -g agent-skills-mesh` → npm 按 platform/arch 自动装平台包 → `asm` 经 wrapper 执行 standalone exe → **零额外依赖，无需 bun/node**（exe 自包含 bun runtime）；CLI 与 TUI 统一在 standalone exe 内，不再 node/bun 分裂。

**开发期**：开发者装 bun，`bun run src/cli/index.ts <cmd>` 直接跑源码（无需 build）。

**代价**：CI 为 6+ 平台各编译 standalone exe；发布流程更复杂（多平台包 + 主包 wrapper）；首次构建需装全平台 native 包。

**体积（Phase 0 实测）**：standalone exe **~68MB/平台**（bun runtime ~50-60MB + opentui native 数 MB + app），编译耗时 ~0.27s/平台（快）。6 平台 ≈ 400MB 总 npm 体积。**npm 发布配额需评估**：免费账号单文件可能受限，参考 opencode（同量级已成功分发）；可能需 npm 组织/付费。**这是 child-4 必须验证的发布阻塞项**。

## 3. 目录结构（新 `src/tui/`）

```
src/tui/
├── index.tsx                # run() 导出 + render(() => <App/>)（含 JSX 故 .tsx；⚠️ APFS 大小写不敏感，勿与 index.ts 共存，勿用 app.tsx）
├── App.tsx                  # Provider 装配 + TabBar + 视图切换 + 全局键（render 入口已并入 index.tsx）
├── theme/
│   └── index.ts             # RGBA 主题（colors + tokens，参考 opencode theme/）
├── context/                 # Solid Context（Provider/use 模式）
│   ├── theme.tsx            # ThemeProvider + useTheme
│   ├── dialog.tsx           # DialogProvider + useDialog（弹窗栈）
│   └── data.tsx             # DataProvider + useData（config/index 快照，替代 useIndexState）
├── state/                   # Solid 状态原语
│   ├── snapshot.ts          # createStore<{config,index}> + 加载/refresh 回写
│   ├── matrix.ts            # createSignal 光标 + createStore pending（skillName→agentId→intent）
│   ├── search.ts            # createSignal 搜索词
│   ├── source.ts            # Source tab 本地状态（选中 source、操作队列）
│   └── doctor.ts            # Doctor tab 本地状态（选中 issue、fix queue）
├── components/
│   ├── TabBar.tsx           # 顶部 [1 Skill×Agent][2 Source][3 Doctor]
│   ├── Matrix.tsx           # skill×agent 表格（box 网格，[on]/[off]/[!]/— 标签）
│   ├── SearchBar.tsx        # / 触发 fuzzy（fuzzysort 或自实现）
│   ├── StatusBar.tsx        # 底部状态 + 快捷键提示栏
│   └── Inspector.tsx        # 选中 skill 的详情（来源/hash/agents）
├── views/                   # 三个 tab 视图
│   ├── SkillAgentView.tsx   # Matrix + Inspector + StatusBar
│   ├── SourceView.tsx       # source 列表 + 操作
│   └── DoctorView.tsx       # issues + adopt 候选 + 修复
├── dialogs/                 # 浮层弹窗
│   ├── Dialog.tsx           # 基础：position absolute + zIndex + RGBA 遮罩
│   ├── ConfirmDialog.tsx    # confirm → Promise<boolean>
│   ├── PromptDialog.tsx     # 输入 → Promise<string|undefined>
│   ├── SelectDialog.tsx     # 选择 → Promise<option|undefined>
│   ├── AddSourceDialog.tsx  # source add 表单（target/branch/type）
│   └── SkillDetailDialog.tsx# skill info 详情
└── keymap.ts                # @opentui/keymap 声明式绑定（可选，也可直接 useKeyboard）
```

## 4. 状态管理（Solid 替代 React reducer）

| 旧（React） | 新（Solid） |
|---|---|
| `useReducer(reducer, init)` | `createStore(initial)` + setter 函数 |
| `dispatch({type:"MOVE_CURSOR"})` | `setMatrix('cursor', ...)` 直接写 |
| `useEffect(回写 snapshot)` | `createEffect(() => { ... })` |
| `useState` | `createSignal` |
| Context + Provider | Solid `createContext` + `<Ctx.Provider>`（同名同构） |

**snapshot store**（`state/snapshot.ts`）：
```ts
export const [snapshot, setSnapshot] = createStore<{
  config: AppConfig | null
  index: IndexFile | null
  loading: boolean
  error: Error | null
}>({ config: null, index: null, loading: true, error: null })
```

**matrix pending store**（`state/matrix.ts`）—— 保留「pending 意图未提交」模型（安全）：
```ts
// skillName → agentId → "install"|"uninstall"，确认前只改这里
export const [pending, setPending] = createStore<Record<string, Record<string, "install"|"uninstall">>>({})
```

数据流（不变的安全模型，只换载体）：
```
DataProvider 加载 config/index（首次缺失自动 refresh）
  → setSnapshot
  → Matrix 渲染 + 用户操作写 pending store
  → enter/a/d 触发 ConfirmDialog
  → 确认 → buildInstallPlan/buildUninstallPlan + apply（core service）
  → refresh → setSnapshot（回写）
```

## 5. 渲染入口与 Provider 装配（`index.tsx`）

```tsx
import { render } from "@opentui/solid"
import { ThemeProvider } from "./context/theme"
import { DialogProvider } from "./context/dialog"
import { DataProvider } from "./context/data"
import { App } from "./App"

export function run() {
  render(() => (
    <ThemeProvider>
      <DataProvider>
        <DialogProvider>
          <App />
        </DialogProvider>
      </DataProvider>
    </ThemeProvider>
  ))
}
```

`App.tsx`（**集中键盘路由**：AppShell 单一 `useKeyboard`，view 不自注册；按 design §6 优先级派发）：
```tsx
const [tab, setTab] = createSignal<"skill"|"source"|"doctor">("skill")
// view 经 ViewKeyContext 注册的 handler（返回 true=已消费，false=交回全局）
let viewHandler: ((key: KeyEvent) => boolean) | null = null
useKeyboard((key) => {
  if (dialog.isOpen()) {                       // 1. 弹窗优先：ESC/ctrl+c 关栈顶
    if (key.name === "escape" || (key.ctrl && key.name === "c")) dialog.closeTop()
    return
  }
  if (viewHandler && viewHandler(key)) return  // 2. view 优先消费（搜索态吞字符、Matrix 键）
  if (key.name === "1") setTab("skill")        // 3. 全局键
  else if (key.name === "2") setTab("source")
  else if (key.name === "3") setTab("doctor")
  else if (key.ctrl && key.name === "r") refresh()  // 全局刷新（ctrl+r）
  else if (key.name === "escape" || (key.ctrl && key.name === "c")) exit()
})
return (
  <ViewKeyProvider value={{ setHandler: (h) => { viewHandler = h } }}>
    <box flexDirection="column" height="100%">
      <TabBar active={tab()} />
      <box flexGrow={1}>
        <Show when={tab()==="skill"}><SkillAgentView/></Show>
        <Show when={tab()==="source"}><SourceView/></Show>
        <Show when={tab()==="doctor"}><DoctorView/></Show>
      </box>
      <StatusBar/>
    </box>
  </ViewKeyProvider>
)
```

> **为什么 view 优先消费而非「全局键优先」**：搜索态是 view 的局部模式，AppShell 不感知。
> view handler 返回 true 时（搜索态收字符、Matrix 操作键）AppShell 跳过全局键，使搜索时
> `1`/`2`/`3`/字母进过滤词而非切 tab。view 不认识的键（`1`/`2`/`3`/`ctrl+r`/`esc`）返回 false
> 交回 AppShell 全局处理。`r` 留给 view 层 review（高频就地操作），refresh 用 `ctrl+r`（低频全局）。

> **为什么不各自 useKeyboard**：opentui 的 `useKeyboard` 无 stopPropagation（`hooks.d.ts` 的
> `UseKeyboardOptions` 只有 `release`），多订阅都收到同一按键 → child-3 加全局键会双触发。故集中路由。

## 6. Matrix 表格组件设计

**布局**：固定列宽（name 列 + 每 agent 一列），box flexbox 横向行。

```tsx
// Matrix.tsx 核心
<box flexDirection="column">
  {/* 表头 */}
  <box flexDirection="row">
    <text width={nameWidth}>Name</text>
    <For each={agents()}>{a => <text width={cellWidth}>{a.id}</text>}</For>
    <text>Status</text>
  </box>
  {/* 行（过滤后 + 滚动窗口） */}
  <For each={visibleSkills()}>{(skill, row) =>
    <box flexDirection="row">
      <text width={nameWidth} backgroundColor={row===cursor.row()?theme.primary:undefined}>
        {skill.name}
      </text>
      <For each={agents()}>{(agent, col) => {
        const label = cellLabel(skill, agent, pending)  // [on]/[off]/—/[!]
        return <text width={cellWidth} fg={cellColor(label)}>{label}</text>
      }}</For>
      <text>{statusSummary(skill)}</text>
    </box>
  }</For>
</box>
```

**单元格标签**（替代难记符号，决策 #5）：

| 状态 | 旧符号 | 新标签 | 颜色 |
|---|---|---|---|
| installed | `✓` | `[on]` | success 绿 |
| available | `○` | `[off]` | muted 灰 |
| unsupported(disabled agent) | `×` | `—` | muted 灰 |
| conflict/broken-link/external | `!` | `[!]` | warning 黄 |
| pending install | `~+` | `[+]` | primary 高亮 |
| pending uninstall | `~-` | `[-]` | warning 高亮 |

**交互**：
- `↑↓` 移行，`←→` 移列（光标在可见单元格上）
- `enter` toggle 当前格（写 pending）
- `a` 当前行所有 agent → install（写 pending）
- `d` 当前行所有 agent → uninstall（写 pending）
- 有 pending 时底部提示 `enter to review` → 进 ConfirmDialog → apply

**滚动**：技能多时维护 `scrollOffset` signal，只渲染可见窗口（性能）。

**小终端守卫**：`useTerminalDimensions()` 取宽高，若 `< 80×24` 打印降级提示并仍渲染（Matrix 列宽按 `Math.max(nameWidth, 8)` 收缩，agents 列数多时横向滚动）。

**键位优先级**（集中路由）：**AppShell 单一 `useKeyboard`** 集中派发（view 经 `ViewKeyContext` 注册 `onKey` handler，**不自注册 useKeyboard**——opentui useKeyboard 无 stopPropagation，多订阅会双触发）。顺序：①弹窗打开时（`useDialog().isOpen()`）拦截 ESC/ctrl+c 关栈顶，其余键交弹窗内部组件；②view handler 优先消费（返回 true=已消费，如搜索态吞字符、Matrix 操作）；③否则全局键（`1`/`2`/`3` tab、`ctrl+r` refresh、`ESC`/`ctrl+c` 退出、`?` help）。`r` 留给 view 层 review（Matrix 写操作确认），避免与 refresh 冲突。

## 7. 弹窗系统（核心诉求，参考 opencode `src/ui/dialog.tsx`）

**基础 Dialog**（`dialogs/Dialog.tsx`）：
```tsx
export function Dialog(props: ParentProps<{ size?: "medium"|"large"; onClose: () => void }>) {
  const dim = useTerminalDimensions()
  const width = props.size === "large" ? 80 : 50
  return (
    <box position="absolute" zIndex={3000} left={0} top={0}
         width={dim().width} height={dim().height}
         backgroundColor={RGBA.fromInts(0,0,0,150)}   // 半透明遮罩
         alignItems="center" paddingTop={Math.floor(dim().height/4)}>
      <box width={width} backgroundColor={theme.backgroundPanel} padding={1}>
        {props.children}
      </box>
    </box>
  )
}
```

**DialogProvider**（`context/dialog.tsx`）：维护弹窗栈（`createStore<{stack: {element: JSX.Element, onClose?: ()=>void}[]}>`），`useDialog()` 暴露 `replace(el, onClose)` / `clear()`，ESC/ctrl+c/遮罩点击关闭（`useKeyboard` + Dialog onMouseUp）。

> **关于 Store 放 JSX.Element**（review 关注点）：opencode 生产代码（`src/ui/dialog.tsx`）正是用 `createStore({stack:[{element: JSX.Element,...}]})`，且 Phase 0 在 0.4.3 下用 `testRender` 验证 solid store 响应式正常。沿用 opencode 模式（已生产验证），不改为 signal 方案。

**异步确认模式**（`ConfirmDialog.tsx`）：
```tsx
ConfirmDialog.show = (dialog, title, message): Promise<boolean> =>
  new Promise(resolve => dialog.replace(
    <ConfirmDialog title={title} message={message}
      onConfirm={() => resolve(true)} onCancel={() => resolve(false)} />,
    () => resolve(undefined)
  ))

// 调用侧
const ok = await ConfirmDialog.show(dialog, "Remove source?", "This orphans N skills.")
if (ok) await removeSource(...)
```

**需要的弹窗**（覆盖 CLI 写操作）：
- `ConfirmDialog` — 删除/卸载/批量确认
- `PromptDialog` — source add（target/branch/type 输入）
- `SelectDialog` — skill add 多来源选择、rebind source 选择
- `AddSourceDialog` — source add 复合表单
- `SkillDetailDialog` — skill info 详情展示

## 8. 主题系统（`theme/index.ts`）

参考 opencode `src/theme/` + 效果图（深色底 + 黄/绿/蓝）。RGBA 颜色集中管理：

```ts
export const theme = {
  background: "#0e1116",
  backgroundPanel: "#161b22",
  text: "#e6edf3",
  textMuted: "#7d8590",
  primary: "#58a6ff",     // 蓝，高亮/光标
  success: "#3fb950",     // 绿，[on]/installed
  warning: "#d29922",     // 黄，[!]/conflict
  danger: "#f85149",      // 红，删除/错误
  accent: "#79c0ff",      // 浅蓝，链接
  overlay: RGBA.fromInts(0,0,0,150),
}
```

**可访问性**：所有状态用文字标签（`[on]`/`[off]`/`installed`/`conflict`）冗余，颜色仅辅助（不单独传递信息）——满足 AC7。

## 9. CLI 功能映射表（AC：对齐全 CLI）

| CLI 命令 | TUI 位置 | 交互 / 弹窗 |
|---|---|---|
| `init` | 留 CLI | TUI 启动前检测 config 存在 |
| `refresh` | 全局 `ctrl+r` | 直接刷新（轻量，可无弹窗） |
| `doctor` | Doctor tab | issues 列表 + `f` 修复（ConfirmDialog） |
| `source add` | Source tab `a` | AddSourceDialog（target/branch/type） |
| `source update` | Source tab `u` | ConfirmDialog |
| `source remove` | Source tab `d` | ConfirmDialog（带 `--purge` 选项 SelectDialog） |
| `source list` | Source tab | 表格展示 |
| `source enable/disable` | Source tab `e`/`x` | 直接切换（轻量，可无弹窗） |
| `skill search` | 全局 `/` | SearchBar fuzzy |
| `skill add` | Source tab 选中技能 `enter` | SelectDialog（选 source） |
| `skill list/info` | Matrix + `i` | SkillDetailDialog |
| `skill update` | Matrix 选中 `u` | ConfirmDialog |
| `skill remove` | Matrix 选中 `d` | ConfirmDialog |
| `skill rebind` | Matrix 选中 `b` | SelectDialog（选 source） |
| `skill enable/disable` | Matrix 单元格 `enter` | toggle（批量时 ConfirmDialog） |

## 10. 测试架构（`@opentui/core/testing` + `@opentui/solid` 的 `testRender`，AC8）

Phase 0 验证的真实 API（`createTestRenderer` / `testRender` 返回 `TestRendererSetup`）：
```ts
import { testRender } from "@opentui/solid"   // 或 createTestRenderer from "@opentui/core/testing"
const t = await testRender(() => <Matrix .../>, { width: 100, height: 30 })
await t.flush()
expect(t.captureCharFrame()).toContain("[on]")            // 快照断言（返回 string）
await t.mockInput.pressKey("return")                      // 模拟按键（pressKey，不是 mockInput({name})）
await t.waitForFrame(frame => frame.includes("[on]"))     // 等条件成立
// helpers: renderOnce / flush / waitFor / waitForFrame / waitForVisualIdle / captureSpans / resize / mockMouse
```

**TestRendererSetup 完整签名**（Phase 0 查证）：`{ renderer, mockInput:{pressKey,pressKeys,KeyCodes}, mockMouse, renderOnce, flush, waitFor, waitForFrame, waitForVisualIdle, externalOutput, captureCharFrame, captureSpans, resize, getNativeStats }`。`KeyCodes` 常量含 RETURN/ESCAPE/ARROW_UP 等用于 `pressKey`。

**测试重写映射**（覆盖旧 `tests/tui/**` 的 **5 文件 47 cases** 行为分类，不固定「13」数字）：
- Matrix 渲染 / 光标移动 / toggle / 批量行（a/d）→ Matrix 组件测试（旧 `matrix.test.tsx` 7 cases）
- pending → plan → apply 流程 → 集成测试（含 ConfirmDialog）（旧 `use-install-plan.test.ts` 5 cases）
- Discover adopt → Doctor tab 候选测试（旧 `discover.test.tsx` 6 cases）
- Doctor 修复 → Doctor view 测试（旧 `doctor.test.tsx` 3 cases）
- reducer 纯函数 → Solid store 操作测试（旧 `reducer.test.ts` 26 cases，直接调 setter 断言 store）

## 11. 关键风险与权衡

| 风险 | 缓解 |
|---|---|
| opentui native 二进制平台覆盖（darwin/linux/win × arm64/x64） | npm 预编译 optionalDependencies，CI 跑多平台 |
| Solid 学习曲线（团队熟 React） | opencode 代码作参考；状态模型保留（snapshot+pending），只换载体 |
| ~~Bun 切换影响 core/cli 测试~~ | ✅ Phase 0 实测：bun 1.3.13 下当前 CLI（commander+core）完整工作（`source list`/`doctor` 成功）；vitest 12 tests 与 node 一致 |
| ~~opentui 0.4.x API 变动~~ | ✅ Phase 0 验证 0.4.3 核心 API 全工作 |
| ~~bun+solid JSX 转译~~（原未识别风险） | ✅ Phase 0 验证：`jsx:preserve` + `bunfig preload=["@opentui/solid/preload"]` = 响应式工作 |
| standalone exe 体积（~68MB/平台） | npm 发布配额需评估（child-4 验证）；opencode 同量级已发 |
| 弹窗焦点/ESC 栈管理复杂 | 直接移植 opencode DialogProvider 模式（Store of elements 已验证） |
| 固定宽高在小终端溢出 | `useTerminalDimensions` + `<80×24` 降级提示 + 列宽收缩（§6） |

## 12. 兼容性与回滚

- core service 层零改动 → TUI 出问题可回退到 CLI（用户仍能完整操作）。
- 旧 Ink `src/tui/**` 整体删除（git 可回滚）。
- `vitest.config.ts` 的 TUI exclude 在测试重写完成后移除。
- 分阶段交付（见 implement.md），每阶段独立可验证。

## 13. 文件归属矩阵（review 维度 6，跨 child 冲突管理）

多个 child 共改同一文件，必须按契约串行：

| 文件 | owner（建） | 扩展者 | 契约/扩展点 |
|---|---|---|---|
| `src/tui/App.tsx` | child-1（骨架+Provider） | child-2（接 SkillAgentView）、child-3（接 Source/Doctor） | **数据驱动 view 注册**：`<Show when={tab()===...}>` 模式，新增 tab 不改 App 结构；**集中键盘路由**：AppShell 单一 `useKeyboard`，view 经 `ViewKeyContext` 注册 `onKey` handler 返回消费语义（true=吞，false=交回全局），**view 不自注册 useKeyboard**（opentui 无 stopPropagation，多订阅双触发）；弹窗 `isOpen()` 时 AppShell 拦截 ESC/ctrl+c 关栈顶，view handler 不被调用 |
| `src/tui/components/StatusBar.tsx` | child-2（建+Matrix hints） | child-3（Source/Doctor hints） | **必须接受 `hints` prop**（当前 tab 注入快捷键提示数组），扩展者不改 StatusBar 结构 |
| `package.json` | child-1（依赖+dev/build） | child-4（bin+optionalDeps） | child-1 按最终态铺骨架（`bin`、`optionalDependencies` 占位），child-4 只填值 |
| `src/cli/index.ts` | child-1（tui import 行） | — | 仅 tui command 懒加载 import 行变更；shebang `#!/usr/bin/env node` 不动 |
| `vitest.config.ts` | — | child-4（remove exclude + 修注释 task id `07-03`→`07-05`） | |
| `bunfig.toml` | child-1（新建 `preload=["@opentui/solid/preload"]`） | — | |
| `tsconfig.json` | child-1（jsx preserve + jsxImportSource） | — | |

**串行规则**：child 严格 infra → matrix → views → test-spec 顺序，不并行（避免 App.tsx/StatusBar/package.json 三处合并冲突）。
