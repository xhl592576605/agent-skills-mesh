/**
 * 业务错误码 + i18n 字典链路测试（W1 补齐）。
 *
 * 覆盖 AC4 的核心保证：每个 `ErrorCode` 都能经 `bizError()` 创建、被 `isBizError()` 识别、
 * 并在 en/zh 两份字典里查到非回退译文（`formatError()` 端到端翻译）。从基准英文字典反推
 * err code 列表，自动覆盖未来新增 code——新增 code 时若漏加字典，本测试立即失败。
 */
import { describe, expect, test } from "vitest";
import { bizError, isBizError, type ErrorCode } from "../src/core/errors.js";
import { t, formatError } from "../src/i18n/index.js";
import type { Locale, TKey } from "../src/i18n/types.js";
import { dict as dictEn } from "../src/i18n/en.js";
import { dict as dictZh } from "../src/i18n/zh-CN.js";

/** 覆盖所有 err.* 占位符的超集参数（多余字段被 `t()` 忽略，缺失字段替换为空串）。 */
const ALL_PARAMS = {
  name: "my-skill",
  id: "my-src",
  path: "/tmp/path",
  url: "https://example.com/repo.git",
  dest: "/tmp/repos/my-src",
  sourceId: "my-src",
  sources: "src-a, src-b",
  line: 42,
  ssotPath: "/tmp/ssot/my-skill",
  tempPath: "/tmp/transfer/xyz",
  sourceDir: "/tmp/source/my-skill",
  message: "boom",
};

/** 从基准英文字典反推全部业务错误码（排除 C 类 systemPrefix——它不是 ErrorCode）。 */
const ERR_CODES = Object.keys(dictEn)
  .filter((k) => k.startsWith("err.") && k !== "err.systemPrefix")
  .map((k) => k.slice("err.".length)) as ErrorCode[];

describe("bizError + i18n 字典链路（W1：每个 ErrorCode 可翻译）", () => {
  test("err code 数量符合预期（防意外删减：Phase B/W2 的 14 + W1 的 19）", () => {
    expect(ERR_CODES).toHaveLength(34);
  });

  test("en/zh 字典 err.* key 集合一致（完整性，AC7）", () => {
    const en = Object.keys(dictEn).filter((k) => k.startsWith("err.")).sort();
    const zh = Object.keys(dictZh).filter((k) => k.startsWith("err.")).sort();
    expect(zh).toEqual(en);
  });

  test.each(ERR_CODES)("ErrorCode %# %s：bizError 创建 + isBizError 识别", (code) => {
    const err = bizError(code, ALL_PARAMS);
    expect(isBizError(err)).toBe(true);
    expect(err.code).toBe(code);
    expect(err.message).toBeTruthy(); // 英文兜底 message 非空
  });

  test.each(ERR_CODES)("ErrorCode %# %s：en/zh 字典均有非回退译文", (code) => {
    const key = `err.${code}` as TKey;
    const en = t(key, "en", ALL_PARAMS);
    const zh = t(key, "zh-CN", ALL_PARAMS);
    expect(en).not.toBe(key); // 非回退到 key 本身（说明字典有该条目）
    expect(zh).not.toBe(key);
    expect(en).not.toBe(zh); // en/zh 译文应不同
  });

  test.each(ERR_CODES)("ErrorCode %# %s：formatError 端到端翻译（走字典而非 message 透传）", (code) => {
    const err = bizError(code, ALL_PARAMS, `FALLBACK_${code}`);
    const locales: Locale[] = ["en", "zh-CN"];
    for (const locale of locales) {
      const text = formatError(err, locale);
      // 翻译结果不应等于英文兜底 message（证明走字典翻译分支）
      expect(text).not.toBe(`FALLBACK_${code}`);
      expect(text).not.toBe(`err.${code}`);
    }
  });
});

describe("formatError C 类系统错误前缀", () => {
  test("普通 Error 用 systemPrefix 包裹原始 message", () => {
    expect(formatError(new Error("disk full"), "en")).toBe("Operation failed: disk full");
    expect(formatError(new Error("disk full"), "zh-CN")).toBe("操作失败：disk full");
  });

  test("字符串错误也走 systemPrefix", () => {
    expect(formatError("oops", "en")).toBe("Operation failed: oops");
  });

  test("BizError 不走 systemPrefix（直接字典翻译）", () => {
    const err = bizError("SKILL_NOT_FOUND", { name: "foo" });
    expect(formatError(err, "en")).toBe("Skill not found: foo");
    expect(formatError(err, "zh-CN")).toBe("找不到技能：foo");
  });
});
