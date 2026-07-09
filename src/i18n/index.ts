/**
 * i18n 核心（design §2.3）：纯函数 `t()` + 插值 + 语言解析链 + 错误格式化。
 *
 * 零依赖，CLI 与 TUI 共用同一 `t()`。core 层不依赖本模块——业务错误以 `code`/`params`
 * 属性附加在 `Error` 实例上（Phase B 的 `bizError()`），由 UI 层调用 `formatError()` 翻译。
 *
 * 缺失 key 回退顺序：当前语言字典 → 基准英文字典 → key 字符串本身（开发期易发现）。
 */

import { execSync } from "node:child_process";
import { dict as dictEn } from "./en.js";
import { dict as dictZh } from "./zh-CN.js";
import type { Dict, Locale, Params, TKey } from "./types.js";

/** 各语言字典。新增语言在此注册。基准字典（en）保证 `t()` 永不返回 undefined。 */
const DICTS: Record<Locale, Partial<Dict>> = { en: dictEn, "zh-CN": dictZh };

/**
 * `{{name}}` 插值：把模板中所有 `{{key}}` 替换为 `params[key]` 的字符串形式。
 * 缺失参数替换为空串（与 design §2.2 一致）。`key` 仅匹配 `\w+`（ASCII 字母数字下划线）。
 */
export function interpolate(template: string, params: Params): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

/**
 * 纯查找 + 插值：按给定字典集合解析 key，回退 `dicts[locale][key]` → `dicts.en[key]` → key 本身。
 *
 * 导出供测试构造受控字典验证回退分支（`t()` 用模块内 `DICTS`，无法模拟「zh 缺 key」）。
 * 业务代码应调用 `t()`，仅在需要自定义字典集合时直接用 `translate()`。
 */
export function translate(
  dicts: Record<Locale, Partial<Dict>>,
  key: TKey,
  locale: Locale,
  params?: Params,
): string {
  const raw = dicts[locale][key] ?? dicts.en[key] ?? key;
  return params ? interpolate(raw, params) : raw;
}

/**
 * 翻译（design §2.3）：用模块内 `DICTS`，缺失时回退基准英文字典，再缺失回退 key 本身。
 * 传 `params` 时做 `{{name}}` 插值。
 */
export function t(key: TKey, locale: Locale, params?: Params): string {
  return translate(DICTS, key, locale, params);
}

/**
 * macOS 系统语言：读 `defaults read -g AppleLanguages` 首选语言。
 *
 * macOS 上终端 `$LANG` 常被工具设为 `en_US.UTF-8` 即使系统 GUI 语言是中文，
 * 故额外读 AppleLanguages 补充判断。非 macOS 或读取失败返回 undefined。
 */
function detectMacOSLanguage(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const out = execSync("defaults read -g AppleLanguages", {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    // 输出形如：( \n    "zh-Hans-CN"\n    "en-US"\n)
    return out
      .split("\n")
      .map((l) => l.trim().replace(/["',]/g, ""))
      .find((l) => /^[a-z]{2}/i.test(l));
  } catch {
    return undefined;
  }
}

/** 读 Intl locale（Windows/通用）：`Intl.DateTimeFormat().resolvedOptions().locale` 返回如 `zh-CN`/`en-US`。弥补 Windows 无 `$LANG`。 */
function detectIntlLocale(): string | undefined {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale;
    return loc || undefined;
  } catch {
    return undefined;
  }
}

/**
 * 读系统 locale：中文（`zh*`）→ `zh-CN`，否则 `en`。
 *
 * 优先级：`LC_ALL`/`LC_MESSAGES`（用户显式 locale 意图）> `LANG` > `Intl`（Windows/通用）
 * > macOS `AppleLanguages`（系统 GUI 语言）> `en`。macOS 特例：终端 `$LANG` 常与系统 GUI 语言
 * 不一致（被工具设为 `en_US.UTF-8` 但系统是中文），故当 `$LANG` 非中文时，额外读
 * `defaults read -g AppleLanguages` 确认系统真实语言。Windows 上 `$LANG` 常不存在，`Intl` 弥补。
 */
export function detectSystemLocale(): Locale {
  // 1. 显式 locale 环境变量（用户明确意图）
  const explicit = process.env.LC_ALL || process.env.LC_MESSAGES;
  if (explicit) return /^zh/i.test(explicit) ? "zh-CN" : "en";
  // 2. LANG
  const lang = process.env.LANG || "";
  if (/^zh/i.test(lang)) return "zh-CN";
  // 3. Intl（Windows/通用，Node/Bun 基于 ICU）：弥补 Windows 无 $LANG
  const intl = detectIntlLocale();
  if (intl && /^zh/i.test(intl)) return "zh-CN";
  // 4. macOS：LANG 非中文时读系统 GUI 语言补充判断
  const macLang = detectMacOSLanguage();
  if (macLang && /^zh/i.test(macLang)) return "zh-CN";
  // 5. 回退
  return "en";
}

/**
 * 解析最终语言。优先级链（AC2）：
 * `explicit`（--lang flag / $ASM_LANG） > `config`（config.toml settings.language）
 * > `detectSystemLocale()`（系统 locale） > `en`。
 *
 * `"auto"` 或空字符串视为「跟随系统」（返回 undefined，让链继续往下）。
 * 非中文值一律归 `en`（本项目仅支持 zh/en）。
 */
export function resolveLanguage(input: { explicit?: string; config?: string }): Locale {
  return normalize(input.explicit) ?? normalize(input.config) ?? detectSystemLocale();
}

/** 把任意输入归一化为 Locale，`"auto"`/空 → undefined（跟随系统）。 */
function normalize(value?: string): Locale | undefined {
  if (!value || value === "auto") return undefined;
  return /^zh/i.test(value) ? "zh-CN" : "en";
}

/**
 * 把任意错误格式化为用户可见文案（R7 分层 i18n）。
 *
 * - **B 类业务错误**：`Error` 实例附加了字符串 `code`（+ 可选 `params`）→ `t("err.<code>")`。
 *   用鸭子类型检测（`typeof err.code === "string"`），**不 import `core/errors.ts`**，
 *   保持 i18n 模块在 Phase A 独立可测；Phase B 的 `bizError()` 会产出同结构。
 * - **C 类系统错误**：其它 `Error` / 非 Error → `err.systemPrefix` 前缀包裹原始 message。
 */
export function formatError(err: unknown, locale: Locale): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") {
      const params = (err as { params?: Params }).params ?? {};
      return t(`err.${code}` as TKey, locale, params);
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  return t("err.systemPrefix", locale, { message });
}

/**
 * 错误详情（无前缀）：bizError → `t("err.<code>")` 翻译；其它 → 原始 message。
 *
 * 与 {@link formatError} 区别：不加 `err.systemPrefix` 前缀。供 UI 层与自带操作上下文
 * （如 `agentManager.toggleFail` = "切换失败：{{message}}"）拼接，避免双重前缀
 * （`toggleFail` + `systemPrefix` 都带"失败"语义会重复）。
 */
export function errorMessage(err: unknown, locale: Locale): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") {
      const params = (err as { params?: Params }).params ?? {};
      return t(`err.${code}` as TKey, locale, params);
    }
  }
  return err instanceof Error ? err.message : String(err);
}

export type { Dict, Locale, Params, TKey } from "./types.js";
