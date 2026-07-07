# Design — 多语言中英文切换与布局适配

> 对应 `prd.md`。本文记录技术设计：架构边界、契约、数据流、兼容性、trade-off、回滚、spec 合规性。

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────┐
│  src/i18n/  (新增·核心模块，CLI 与 TUI 共用，零依赖)      │
│    types.ts    Locale / TKey / Dict 类型                  │
│    en.ts       英文字典 (基准)                            │
│    zh-CN.ts    中文字典                                   │
│    index.ts    t() · resolveLanguage() · detectLocale()  │
│                · formatError() · errorTextMap             │
└─────────────────────────────────────────────────────────┘
            ▲                          ▲
            │ 纯函数 t()               │ useI18n() 响应式包装
            │                          │
┌───────────┴──────────┐    ┌──────────┴──────────────────┐
│  src/cli/            │    │  src/tui/                    │
│  --lang global opt   │    │  I18nProvider + useI18n()    │
│  resolveLanguage()   │    │  lang signal · L 键热切换     │
│  所有 console 改 t()  │    │  所有 UI 文本改 t()          │
└──────────────────────┘    └──────────────────────────────┘
            ▲                          ▲
            │                          │
┌───────────┴──────────────────────────┴──────────────────┐
│  src/core/  (最小改动，独立 phase)                        │
│  · models/config.ts: settings.language 字段              │
│  · storage/config-store.ts: 序列化/解析 language + 默认值 │
│  · errors.ts (新增): ErrorCode + bizError() 工厂         │
│  · services/*: throw new Error(英文) → throw bizError()  │
│    (Error 实例附加 code/params，非子类，符合 spec)        │
└──────────────────────────────────────────────────────────┘
```

**分层原则**：i18n 字典与 `t()` 只被 UI 层（cli/tui）依赖；core 层**不依赖 i18n**，只产出错误码（附加在 Error 上），由 UI 层翻译。core 保持可独立测试、不被展示文案耦合。

## 2. i18n 模块设计（`src/i18n/`）

### 2.1 `types.ts`

```ts
export type Locale = "en" | "zh-CN";
export type Params = Record<string, string | number>;
// 字典 key 联合类型——从 en.ts 反推，保证类型安全与字典完整性
export type TKey = keyof typeof import("./en.js").dict;
export type Dict = Record<TKey, string>;
```

### 2.2 字典格式（`en.ts` / `zh-CN.ts`）

```ts
// en.ts (基准)
export const dict = {
  "cmd.init.desc": "Initialize Agent Skills Mesh home",
  "dialog.addAgent.title": "Add agent — id",
  "dialog.deleteSkill.title": "Delete skill?",
  "dialog.confirm.delete": "delete",
  "dialog.confirm.cancel": "cancel",
  "msg.initialized": "Initialized {{home}}",
  "msg.addedSource": "Added source {{id}} ({{type}}) -> {{path}}",
  "msg.noSourceSelected": "no source selected",
  "msg.enabled": "{{id}} enabled",
  "err.SKILL_NOT_FOUND": "Skill not found: {{name}}",      // ← key = ErrorCode
  "err.AGENT_NOT_FOUND": "Agent not found: {{id}}",
  "err.INSTALL_PLAN_CONFLICT": "Install plan has conflicts",
  "err.systemPrefix": "Operation failed: {{message}}",     // C 类系统错误前缀
  "help.global": "1/2/3 tabs · ctrl+r refresh · L lang · ? help · esc/ctrl+c exit",
  // ...
} as const;
```

**key 命名规范**：点分命名空间 `<域>.<子域>`。域：`cmd`/`dialog`/`msg`/`err`/`help`/`tab`/`table`/`common`。错误码 key 一律 `err.<CODE>`，与 `ErrorCode` 一一对应。

**插值**：`{{name}}` → `t()` 内 `key.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params?.[k] ?? ""))`。

**缺失 key 回退**：zh-CN 缺 key → en → 仍缺 → 返回 key 字符串本身（dev 期易发现）。字典完整性测试保证两份字典 key 集合一致（AC7）。

### 2.3 `index.ts` 核心

```ts
import { dict as en } from "./en.js";
import { dict as zh } from "./zh-CN.js";
const DICTS: Record<Locale, Partial<Dict>> = { en, "zh-CN": zh };

export function t(key: TKey, locale: Locale, params?: Params): string {
  const raw = DICTS[locale][key] ?? en[key] ?? key;
  return params ? interpolate(raw, params) : raw;
}

/** 优先级链：explicit(flag/env) > config > system locale > en */
export function resolveLanguage(input: { explicit?: string; config?: string }): Locale {
  const pick = normalize(input.explicit) ?? normalize(input.config) ?? detectSystemLocale();
  return pick === "zh-CN" ? "zh-CN" : "en";
}
function normalize(v?: string): Locale | undefined {
  if (!v || v === "auto") return undefined;      // "auto" = 跟随系统
  return v.startsWith("zh") ? "zh-CN" : "en";
}
/** 读 LANG/LC_ALL/LC_MESSAGES，中文* → zh-CN，否则 en */
export function detectSystemLocale(): Locale {
  const raw = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "";
  return /^zh/i.test(raw) ? "zh-CN" : "en";
}
```

## 3. 语言解析优先级链（AC2）

```
--lang flag  >  $ASM_LANG  >  config.language  >  detectSystemLocale()  >  "en"
```

- **CLI**：`cli/index.ts` 启动时合成 explicit（`opts.lang ?? process.env.ASM_LANG`）+ 读 config.language，调 `resolveLanguage()` 得 Locale，传入各 action。
- **TUI**：`run()` 解析初始 Locale（flag 优先于 config）；进入 I18nProvider 后，`L` 键热切换只改 signal + 写回 config，不重启。

## 4. `config.language` 扩展（R3）

### 4.1 `models/config.ts`
```ts
settings: {
  install_strategy: "symlink";
  default_agent: string;
  auto_refresh_on_start: boolean;
  language: "auto" | "zh-CN" | "en";   // ← 新增
};
```

### 4.2 `config-store.ts` 改动
- `createDefaultConfig()`：`settings.language = "auto"`。
- `serializeConfig()`：`[settings]` 段追加 `language = ${quote(config.settings.language)}`。
- `parseConfig()`：既有 `section === "settings"` 的 `(config.settings as Record<string, unknown>)[key] = value` 自动收入 language，**无需特判**；缺失时 `createDefaultConfig` 已提供 "auto" 默认。

**向后兼容**：旧 config.toml 无 `language` 行 → 解析得 "auto" → 等同跟随系统 locale。无需迁移脚本。

## 5. core 错误码体系（R7-B 类）— **符合 error-handling spec**

> ⚠️ **spec 合规**：`backend/error-handling.md` 规定 "Do not add custom error hierarchies **unless** the caller needs programmatic branching that cannot be represented by existing typed statuses"。i18n 需按错误类型选翻译，正是此例外。本设计**不建 Error 子类**，而是给 `Error` 实例附加 `code`/`params` 属性——字面上不构成 "hierarchy"，且保留了 spec 要求的"unrecoverable CLI failures 用 Error 抛出"形态。详见 §14。

### 5.1 `src/core/errors.ts`（新增）

```ts
export type ErrorCode =
  | "SKILL_NOT_FOUND"
  | "AGENT_NOT_FOUND"
  | "NO_INSTALLABLE_CANDIDATE"
  | "INSTALL_PLAN_CONFLICT"
  | "UNINSTALL_PLAN_CONFLICT"
  | "REPAIR_PLAN_CONFLICT"
  | "REPAIR_TARGET_MISSING"
  | "REPAIR_TARGET_NOT_SYMLINK"
  | "SOURCE_NOT_FOUND"
  | "INVALID_TOML";

// 不建子类：Error 实例 + 附加属性（符合 spec "no custom hierarchies"）
export type BizError = Error & { code: ErrorCode; params: Record<string, string | number> };

/** 创建带错误码的 Error（仍是 Error 实例，非子类）。message 保留英文兜底供日志/非 i18n 场景。 */
export function bizError(code: ErrorCode, params: Record<string, string | number> = {}, message?: string): BizError {
  const err = new Error(message ?? code) as BizError;
  err.code = code;
  err.params = params;
  return err;
}

export function isBizError(e: unknown): e is BizError {
  return e instanceof Error && typeof (e as { code?: unknown }).code === "string";
}
```

### 5.2 改造点（`throw new Error(英文) → throw bizError(CODE, params, 英文兜底)`）

| 文件:行 | 原文 | code | params |
|---|---|---|---|
| `install-service.ts:73` | `Skill not found: ${skillName}` | `SKILL_NOT_FOUND` | `{name}` |
| `install-service.ts:78/162/198` | `Agent not found: ${agentId}` | `AGENT_NOT_FOUND` | `{id}` |
| `install-service.ts:94` | `No installable candidate for skill` | `NO_INSTALLABLE_CANDIDATE` | `{name}` |
| `install-service.ts:138/180/219` | `... plan has conflicts` | `INSTALL/UNINSTALL/REPAIR_PLAN_CONFLICT` | — |
| `install-service.ts:221/222` | `Repair target ...` | `REPAIR_TARGET_MISSING/NOT_SYMLINK` | `{path}` |
| `ssot-service.ts:45` | `Source ...` | `SOURCE_NOT_FOUND` | — |
| `config-store.ts:170` | `Invalid TOML assignment` | `INVALID_TOML` | `{line}` |

> `throw bizError("SKILL_NOT_FOUND", { name }, \`Skill not found: ${name}\`)` —— 保留第三参英文 message 作为兜底（i18n 不可用时、日志、或 `--lang en` 时 `t()` 直接用 en 字典而非此 message，但留着无害且便于排错）。

### 5.3 UI 层 catch 翻译（`src/i18n/index.ts` 共用 helper）

```ts
import { isBizError } from "../core/errors.js";

export function formatError(err: unknown, locale: Locale): string {
  if (isBizError(err)) {
    return t(`err.${err.code}` as TKey, locale, err.params);   // B 类：纯中/英文
  }
  const msg = err instanceof Error ? err.message : String(err);
  return t("err.systemPrefix", locale, { message: msg });      // C 类：前缀包裹
}
```

CLI：`cli/index.ts:349` `console.error(err.message)` → `console.error(formatError(err, lang))`。
TUI：各 `setMessage(\`xxx failed: ${err...}\`)` → `setMessage(formatError(err, lang))`。

## 6. TUI 响应式 i18n（R4/R6）

### 6.1 `src/tui/context/i18n.tsx`（新增，照 `theme.tsx` 模式）

> 遵循 `frontend/solid-patterns.md` Owner Context 规则：`useI18n()` 在组件体调用并捕获值，不在 `useKeyboard`/async 回调内调用。

```tsx
const I18nContext = createContext<I18nCtx>();

export interface I18nCtx {
  locale: () => Locale;
  t: (key: TKey, params?: Params) => string;   // 内部读 locale()，响应式
  setLocale: (l: Locale) => Promise<void>;      // 切换 + 写回 config
  toggle: () => Promise<void>;                  // zh↔en 互切
}

export function I18nProvider(props: ParentProps<{ initial: Locale; configStore: ConfigStore }>) {
  const [locale, setLocaleSig] = createSignal(props.initial);
  const t = (key: TKey, params?: Params) => i18nT(key, locale(), params);
  const persist = async (l: Locale) => {
    setLocaleSig(l);
    try {
      const cfg = await props.configStore.read();
      cfg.settings.language = l;
      await props.configStore.write(cfg);
    } catch { /* 写回失败不阻塞 UI，下次启动按原 config */ }
  };
  const toggle = () => persist(locale() === "zh-CN" ? "en" : "zh-CN");
  return (
    <I18nContext.Provider value={{ locale, t, setLocale: persist, toggle }}>
      {props.children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nCtx {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n must be inside I18nProvider");
  return v;
}
```

### 6.2 Provider 装配（`App.tsx`）
`App()` 内 `ThemeProvider` 之后插入 `I18nProvider`。`run()`（`tui/index.tsx`）解析初始 Locale 后传入 `<I18nProvider initial={lang} configStore={...}>`。

### 6.3 文本替换范围
- `TABS`/`TAB_HINTS`：静态 `const` → 组件内 `createMemo` 依赖 `t()`，或函数 `tabLabels(t)` / `tabHints(t, tab)`。
- `showHelp()`：弹窗 4 段文本改 `t()`。
- `StatusBar`：父传 `t()` 后的字符串，组件无需改（已接受 `string[]`）。
- `dialogs/*.tsx`（10 个）：标题/placeholder/按钮 label 改 `t()`。
- `views/*.tsx`（3 个）：`setMessage`/`ConfirmDialog`/`SelectDialog` 文本改 `t()`；错误用 `formatError`。
- `components/{Matrix,SearchBar,StatusBar,Inspector}.tsx`：可见文本改 `t()`。

### 6.4 热切换键 `L`（R6）— **遵循 solid-patterns 键位检测规则**

> ⚠️ **键位检测**：`frontend/solid-patterns.md` 明确——`key.name` 永远小写，大写字母须用 `key.name === "f" && key.shift` 检测，**绝不能用** `key.name === "F"`（永不匹配）。

在 `createAppShellKeyHandler`（`state/app-keys.ts`）中，**弹窗判断之后、view handler 之前**插入（前置优先级确保搜索态/matrix 的 `l` 右移不拦截 shift+l）：

```ts
// 1.5 语言热切换（全局，优先于 view handler）
// 检测 shift+l：solid-patterns 规定 key.name 恒小写，大写看 key.shift
if (key.name === "l" && key.shift) { deps.toggleLang(); return; }
```

`AppShellKeyDeps` 新增 `toggleLang: () => void`，AppShell 在组件体捕获 `const i18n = useI18n()` 后注入 `i18n.toggle`（Owner Context 安全）。help bar global 段追加 `L lang` 提示。

## 7. CLI 接入（R2）

### 7.1 全局 `--lang` option
```ts
program.option("-L, --lang <lang>", "language: zh | en | auto (default: auto)");
```
封装 `resolveCliLang()`：`resolveLanguage({ explicit: opts.lang ?? process.env.ASM_LANG, config: (await readConfig()).settings.language })`，每个 action 首行调用。

> commander 子 command 默认不继承 program option；最稳妥是封装 `resolveCliLang()` 在每个 action 内调 `program.opts().lang`（program 级 option 在 action 经 parent 可读）。实现时验证。

### 7.2 console 消息替换
`cli/index.ts` 所有 `console.log/error` 可见文本改 `t()`；`formatError(err, lang)` 处理错误；表头 `["SKILL",...]` 改 `t()`。

> **MVP 取舍**：commander `description()`/`option()` 在 parse 前（lang 未知）绑定，`--help` 双语需二次构建 command 树，复杂度高。MVP 让 `--help` 文本保持英文，只 i18n 运行时 console 输出与表头（AC8 相应降级，见 implement.md Phase D 风险）。

## 8. 布局适配策略（R8/AC6）

| 元素 | en 现状 | zh-CN 预期 | 风险 | 应对 |
|---|---|---|---|---|
| StatusBar hints | 短英文词组 | 更短中文 | 低 | 确认不因短而错位 |
| help 弹窗 | 长英文 help bar | 中文词更短 | 低 | 弹窗自适应宽度 |
| `SSOT→单一可信源` | 4 字 | 5 字 | 中（变长） | 出现处为 dialog/message，可换行 |
| `symlink→符号链接` | 6 字 | 4 字 | 低 | — |
| 表格列宽 | renderTable 已 CJK 双宽 | 中文更窄 | 低 | 固定 widths 处英文变长才溢出，校验 SSOT 列 |
| tab `1 Skill×Agent` | 英文 | `1 技能×智能体` | 低 | TabBar 自适应 |

**双向校验**：每元素 zh-CN/en 各渲染一次目测 + 列宽断言。`renderTable` 固定 widths（`[24,9,48]`）需确认翻译后不溢出。

## 9. 切换键与现有键位无冲突确认

- 已占用全局：`1/2/3/ctrl+r/?/esc/ctrl+c`。
- view 消费：`a/d/e/x/r/i/m/u/f/F/h/j/k/箭头/enter/space//` + matrix 的 hjkl（含 **`l`=右移**）。
- **`l`（小写）被 matrix hjkl 消费作右移**，但热切换键用 **shift+l**，且 `toggleLang` 在 view handler **之前**无条件拦截 `key.name === "l" && key.shift`，故 shift+l 不到 view handler，与右移不冲突。普通 `l`（无 shift）正常右移。
- help 弹窗内不切（MVP）；弹窗态优先级最高，shift+l 在弹窗打开时被弹窗吞（可接受，关闭弹窗后再切）。

## 10. 兼容性与迁移
- **config 向后兼容**：旧 config 无 language → "auto"，无需迁移。
- **字典完整性**：CI 断言 `Object.keys(en) === Object.keys(zh-CN)`（AC7）。
- **错误码兼容**：现有测试若断言 `err.message` 含特定英文，改断言 `isBizError(err) && err.code === ...`；err.message 保留英文兜底，影响可控。

## 11. 关键 Trade-offs
1. **自建字典 vs 库**：选自建。零依赖、CLI/TUI 共用、无 Bun 兼容风险。~100 key 远未到需 i18next 的规模。
2. **core 错误码（Error+属性）vs 只包 UI**：选错误码。代价 = ~12 处 throw 改造 + `errors.ts`；收益 = 中文模式错误也中文化、业务逻辑与文案解耦。采用 Error+code 属性而非子类，符合 error-handling spec。
3. **TUI 热切换 vs 重启**：选热切换。solid-js 响应式使边际成本极低（文本抽离本就要做）。
4. **`shift+l` 键位**：各 view 未用 shift+l；`L`=Language 直觉；前置优先级避开 matrix 右移冲突。

## 12. 回滚形态
- i18n 模块独立新增，删 `src/i18n/` + 还原 `t()` 调用点可回滚（调用点多，成本中等）。
- core 错误码可独立回滚（`bizError()` → `new Error()`），不影响 i18n 字典。
- config.language 向后兼容，回滚后旧 config 仍可读。
- 建议**分阶段提交**（见 implement.md），每阶段独立验证与回滚。

## 13. 不在本次设计范围
- 第三种语言（架构已留扩展点：Locale 联合 + DICTS map 追加）。
- SKILL.md 正文翻译、复数/性别/ICU。
- locale 持久化到 state.json（config.toml 已足够）。

## 14. Spec 合规性（本次设计对照 `.trellis/spec/`）

| spec | 约束 | 本设计如何遵守 |
|---|---|---|
| `backend/error-handling.md` | "Do not add custom error hierarchies **unless** caller needs programmatic branching" | i18n 需按错误类型选翻译 = 合规例外；采用 **Error 实例 + code/params 属性**（非子类），不构成 hierarchy；保留 spec 要求的"Error 抛 unrecoverable failures"形态 |
| `backend/error-handling.md` | typed statuses（InstallAction/DoctorCheck 等）优先于 throw | 本设计不改动既有 typed statuses 路径；只对**已 throw 的 command-stopping failures** 附加 code，不把可预期问题改成 throw |
| `backend/directory-structure.md` | core 分 models/scanners/services/storage；kebab-case 文件名 | `errors.ts` 放 `src/core/`（跨 services 的共享错误类型）；kebab-case 遵守 |
| `backend/logging-guidelines.md` | CLI 用 console 输出，无 logger | `t()` 输出仍走 `console.log/error`，不引入 logger |
| `frontend/quality-guidelines.md` | "Modifying src/core/** from a **TUI task** is core-zero-change" | 本任务**非纯 TUI 任务**，是跨 CLI+TUI+core 的 i18n 任务，core 改动在 PRD 范围内；但 core 改动作为**独立 Phase B/C** 与 TUI 改动分离 |
| `frontend/solid-patterns.md` | key.name 恒小写，大写看 key.shift；Owner Context 在组件体捕获 | L 键用 `key.name === "l" && key.shift`；`useI18n()` 在组件体调用 |
| `frontend/solid-patterns.md` | 集中键位路由，view 不自订 useKeyboard | `toggleLang` 注入 app-keys 全局路由，不自订订阅 |
| `frontend/component-guidelines.md` | OpenTUI box/text 原语 | 文本替换仅改字符串来源（走 `t()`），不改组件结构 |

> **需在 Phase F 更新 spec**：`backend/error-handling.md` 增加"i18n 错误码约定"小节，记录 `bizError()`/`isBizError()` 模式与 `ErrorCode` 列表，使本次例外成为文档化约定（Trellis spec-driven 工作流要求）。
