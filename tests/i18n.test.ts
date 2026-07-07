/**
 * i18n 核心模块测试（implement.md Phase A）。
 *
 * 覆盖：插值、回退链、字典完整性（AC7 核心）、语言解析优先级链、locale 探测、错误格式化。
 * 用 `translate()` 构造受控字典验证「zh 缺 key → en」回退（t() 用模块内 DICTS 无法模拟）。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

// mock execSync：默认抛错（模拟非 macOS / defaults 不可用），让 detectSystemLocale 的
// env 测试只依赖环境变量；macOS AppleLanguages 路径由专项测试 mockReturnValue 覆盖。
const { execSyncMock } = vi.hoisted(() => ({ execSyncMock: vi.fn(() => { throw new Error("mocked"); }) }));
vi.mock("node:child_process", () => ({ execSync: execSyncMock }));

import {
  t,
  translate,
  interpolate,
  resolveLanguage,
  detectSystemLocale,
  formatError,
  type Locale,
} from "../src/i18n/index.js";
import { dict as dictEn } from "../src/i18n/en.js";
import { dict as dictZh } from "../src/i18n/zh-CN.js";

// === 插值 ===
describe("interpolate", () => {
  test("替换单个 {{name}}", () => {
    expect(interpolate("Hello {{name}}", { name: "world" })).toBe("Hello world");
  });

  test("替换多个不同占位符", () => {
    expect(interpolate("{{a}}+{{b}}={{c}}", { a: 1, b: 2, c: 3 })).toBe("1+2=3");
  });

  test("number 参数转字符串", () => {
    expect(interpolate("count={{n}}", { n: 42 })).toBe("count=42");
  });

  test("缺失参数替换为空串（不保留占位符）", () => {
    expect(interpolate("v={{missing}}", {})).toBe("v=");
  });

  test("同一占位符多次出现全部替换", () => {
    expect(interpolate("{{x}}{{x}}", { x: "ab" })).toBe("abab");
  });

  test("无占位符原样返回", () => {
    expect(interpolate("plain text", { unused: "x" })).toBe("plain text");
  });

  test("不匹配非 {{ }} 形式（如 {name}）", () => {
    expect(interpolate("{name} {{name}}", { name: "X" })).toBe("{name} X");
  });
});

// === 回退链（用 translate 构造受控字典）===
describe("回退链", () => {
  test("zh 缺 key → 回退 en（translate 构造字典）", () => {
    const dicts = {
      en: { greet: "Hello" } as Record<string, string>,
      "zh-CN": {} as Record<string, string>,
    } as unknown as Record<Locale, Partial<typeof dictEn>>;
    expect(translate(dicts, "greet" as keyof typeof dictEn, "zh-CN")).toBe("Hello");
  });

  test("en 也缺 key → 回退 key 字符串本身", () => {
    const dicts = { en: {}, "zh-CN": {} } as unknown as Record<
      Locale,
      Partial<typeof dictEn>
    >;
    expect(translate(dicts, "__missing__" as keyof typeof dictEn, "en")).toBe("__missing__");
    expect(translate(dicts, "__missing__" as keyof typeof dictEn, "zh-CN")).toBe("__missing__");
  });

  test("en 缺 key → 回退 key（t() 用真实字典，传不存在的 key）", () => {
    expect(t("__nonexistent__" as keyof typeof dictEn, "en")).toBe("__nonexistent__");
    expect(t("__nonexistent__" as keyof typeof dictEn, "zh-CN")).toBe("__nonexistent__");
  });

  test("zh 正常命中返回 zh 值（含插值）", () => {
    expect(t("err.SKILL_NOT_FOUND", "zh-CN", { name: "foo" })).toBe("找不到技能：foo");
  });

  test("en 正常命中返回 en 值（含插值）", () => {
    expect(t("err.SKILL_NOT_FOUND", "en", { name: "foo" })).toBe("Skill not found: foo");
  });
});

// === 字典完整性（AC7 核心）===
describe("字典完整性", () => {
  test("en / zh-CN 的 key 集合完全一致", () => {
    const ek = Object.keys(dictEn).sort();
    const zk = Object.keys(dictZh).sort();
    expect(zk).toEqual(ek);
  });

  test("en 无重复 key（对象字面量去重）", () => {
    const keys = Object.keys(dictEn);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("每个 key 的 en/zh 占位符集合一致", () => {
    const re = /\{\{(\w+)\}\}/g;
    for (const [key, enVal] of Object.entries(dictEn)) {
      const ep = (enVal.match(re) || []).sort();
      const zp = (dictZh[key as keyof typeof dictZh].match(re) || []).sort();
      expect(zp, `placeholder mismatch at ${key}`).toEqual(ep);
    }
  });

  test("所有字典值为非空字符串", () => {
    for (const [key, val] of Object.entries(dictEn)) {
      expect(val, `en.${key} should be non-empty`).toBeTruthy();
    }
    for (const [key, val] of Object.entries(dictZh)) {
      expect(val, `zh.${key} should be non-empty`).toBeTruthy();
    }
  });
});

// === 语言解析优先级链（AC2）===
describe("resolveLanguage 优先级链", () => {
  beforeEach(() => setEnv({ LANG: "en_US.UTF-8", LC_ALL: "", LC_MESSAGES: "" }));
  afterEach(() => restoreEnv());

  test("explicit 覆盖 config 与系统 locale", () => {
    expect(resolveLanguage({ explicit: "zh", config: "en" })).toBe("zh-CN");
    expect(resolveLanguage({ explicit: "en", config: "zh-CN" })).toBe("en");
  });

  test("explicit 缺省时 config 覆盖系统 locale", () => {
    expect(resolveLanguage({ config: "zh-CN" })).toBe("zh-CN");
    expect(resolveLanguage({ config: "en" })).toBe("en");
  });

  test('"auto" = 跟随系统（explicit 与 config 都透明）', () => {
    expect(resolveLanguage({ explicit: "auto", config: "zh-CN" })).toBe("zh-CN");
    expect(resolveLanguage({ explicit: "auto", config: "en" })).toBe("en");
    expect(resolveLanguage({ config: "auto" })).toBe(detectSystemLocale());
  });

  test("undefined 全回退到系统 locale", () => {
    expect(resolveLanguage({})).toBe(detectSystemLocale());
    expect(resolveLanguage({ explicit: undefined, config: undefined })).toBe(
      detectSystemLocale(),
    );
  });

  test("空字符串等价于 auto（跟随系统）", () => {
    expect(resolveLanguage({ explicit: "", config: "zh-CN" })).toBe("zh-CN");
    expect(resolveLanguage({ explicit: "", config: "" })).toBe(detectSystemLocale());
  });

  test("非中文 explicit 一律归 en（仅支持 zh/en）", () => {
    expect(resolveLanguage({ explicit: "fr" })).toBe("en");
    expect(resolveLanguage({ explicit: "ja" })).toBe("en");
  });

  test("大小写不敏感（ZH / Zh → zh-CN）", () => {
    expect(resolveLanguage({ explicit: "ZH-CN" })).toBe("zh-CN");
    expect(resolveLanguage({ explicit: "Zh" })).toBe("zh-CN");
    expect(resolveLanguage({ explicit: "EN" })).toBe("en");
  });

  test("系统为中文 locale 时，无 explicit/config → zh-CN", () => {
    setEnv({ LANG: "zh_CN.UTF-8" });
    expect(resolveLanguage({})).toBe("zh-CN");
  });
});

// === 系统 locale 探测 ===
describe("detectSystemLocale", () => {
  beforeEach(() => setEnv({}));
  afterEach(() => {
    restoreEnv();
    execSyncMock.mockReset();
  });

  test("zh_CN.UTF-8 → zh-CN", () => {
    setEnv({ LANG: "zh_CN.UTF-8" });
    expect(detectSystemLocale()).toBe("zh-CN");
  });

  test("zh_TW.UTF-8 → zh-CN", () => {
    setEnv({ LANG: "zh_TW.UTF-8" });
    expect(detectSystemLocale()).toBe("zh-CN");
  });

  test("en_US.UTF-8 → en", () => {
    setEnv({ LANG: "en_US.UTF-8" });
    expect(detectSystemLocale()).toBe("en");
  });

  test("空 env → en", () => {
    setEnv({ LANG: "", LC_ALL: "", LC_MESSAGES: "" });
    expect(detectSystemLocale()).toBe("en");
  });

  test("LC_ALL 优先于 LANG", () => {
    setEnv({ LC_ALL: "zh_CN.UTF-8", LANG: "en_US.UTF-8" });
    expect(detectSystemLocale()).toBe("zh-CN");
  });

  test("LC_MESSAGES 优先于 LANG", () => {
    setEnv({ LC_MESSAGES: "zh_CN.UTF-8", LANG: "en_US.UTF-8" });
    expect(detectSystemLocale()).toBe("zh-CN");
  });

  test("大小写不敏感（ZH_CN → zh-CN）", () => {
    setEnv({ LANG: "ZH_CN.UTF-8" });
    expect(detectSystemLocale()).toBe("zh-CN");
  });

  // macOS 特例：$LANG 常与系统 GUI 语言不一致（被设为 en_US.UTF-8 但系统是中文），
  // 此时读 AppleLanguages 补充判断。
  test("macOS AppleLanguages 中文（LANG=en_US）→ zh-CN", () => {
    execSyncMock.mockReturnValue('( \n    "zh-Hans-CN"\n    "en-US"\n)');
    setEnv({ LANG: "en_US.UTF-8", LC_ALL: "", LC_MESSAGES: "" });
    expect(detectSystemLocale()).toBe("zh-CN");
  });

  test("macOS AppleLanguages 英文 → en", () => {
    execSyncMock.mockReturnValue('( \n    "en-US"\n)');
    setEnv({ LANG: "en_US.UTF-8", LC_ALL: "", LC_MESSAGES: "" });
    expect(detectSystemLocale()).toBe("en");
  });

  test("macOS defaults 读取失败 → 回退 LANG/en", () => {
    execSyncMock.mockImplementation(() => { throw new Error("fail"); });
    setEnv({ LANG: "en_US.UTF-8", LC_ALL: "", LC_MESSAGES: "" });
    expect(detectSystemLocale()).toBe("en");
  });
});

// === formatError（R7 分层 i18n）===
describe("formatError", () => {
  /** 模拟 Phase B 的 bizError 结构：Error 实例 + code/params 属性。 */
  function fakeBizError(code: string, params: Record<string, string | number>): Error {
    return Object.assign(new Error(code), { code, params });
  }

  test("带 code 的 Error → t(err.<code>, params) [zh-CN]", () => {
    const err = fakeBizError("SKILL_NOT_FOUND", { name: "foo" });
    expect(formatError(err, "zh-CN")).toBe("找不到技能：foo");
  });

  test("带 code 的 Error → t(err.<code>, params) [en]", () => {
    const err = fakeBizError("AGENT_NOT_FOUND", { id: "claude" });
    expect(formatError(err, "en")).toBe("Agent not found: claude");
  });

  test("带 code 的 Error，无 params → 直接翻译", () => {
    const err = fakeBizError("INSTALL_PLAN_CONFLICT", {});
    expect(formatError(err, "zh-CN")).toBe("安装计划存在冲突");
    expect(formatError(err, "en")).toBe("Install plan has conflicts");
  });

  test("带 code 但 params 缺失属性 → 插值空串", () => {
    const err = Object.assign(new Error("x"), { code: "SKILL_NOT_FOUND" });
    expect(formatError(err, "en")).toBe("Skill not found: ");
  });

  test("code 类型非 string → 视为系统错误（前缀包裹）", () => {
    const err = Object.assign(new Error("boom"), { code: 123 });
    expect(formatError(err, "en")).toBe("Operation failed: boom");
  });

  test("普通 Error → systemPrefix 前缀包裹原始 message [zh-CN]", () => {
    expect(formatError(new Error("disk full"), "zh-CN")).toBe("操作失败：disk full");
  });

  test("普通 Error → systemPrefix [en]", () => {
    expect(formatError(new Error("disk full"), "en")).toBe("Operation failed: disk full");
  });

  test("字符串 → systemPrefix", () => {
    expect(formatError("oops", "zh-CN")).toBe("操作失败：oops");
    expect(formatError("oops", "en")).toBe("Operation failed: oops");
  });

  test("number → systemPrefix（String 化）", () => {
    expect(formatError(42, "zh-CN")).toBe("操作失败：42");
  });

  test("null/undefined → systemPrefix（String 化）", () => {
    expect(formatError(null, "en")).toBe("Operation failed: null");
    expect(formatError(undefined, "en")).toBe("Operation failed: undefined");
  });
});

// === env 辅助：精确控制 LC_ALL / LC_MESSAGES / LANG ===
const ENV_KEYS = ["LANG", "LC_ALL", "LC_MESSAGES"] as const;
let saved: Record<string, string | undefined> = {};

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  // 首次调用时保存原始值（供 restore）。
  if (Object.keys(saved).length === 0) {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  }
  for (const k of ENV_KEYS) {
    const v = values[k];
    if (v === undefined || v === "") delete process.env[k];
    else process.env[k] = v;
  }
}

function restoreEnv(): void {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  saved = {};
}
