import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { createSymlink, normalizeLinkTarget } from "../src/utils/fs.js";
import { assertSafeSkillName } from "../src/utils/safe-path.js";
import { samePath } from "../src/core/services/ssot-service.js";
import { detectSystemLocale } from "../src/i18n/index.js";
import { isBizError } from "../src/core/errors.js";
import { StateStore } from "../src/core/storage/state-store.js";

/** 临时覆盖 process.platform（Node 中 process.platform 可写）。 */
function withPlatform<T>(plat: string, fn: () => T): T {
  const orig = process.platform;
  Object.defineProperty(process, "platform", { value: plat, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", { value: orig, configurable: true, writable: true });
  }
}

async function mkTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("createSymlink 平台分支 (AC1)", () => {
  test("POSIX 用 'dir' type", async () => {
    const spy = vi.spyOn(fs, "symlink").mockResolvedValue(undefined);
    await createSymlink("/tmp/asm-target", "/tmp/asm-src");
    expect(spy).toHaveBeenCalledWith("/tmp/asm-src", "/tmp/asm-target", "dir");
    vi.restoreAllMocks();
  });

  test("win32 用 'junction' type", async () => {
    const spy = vi.spyOn(fs, "symlink").mockResolvedValue(undefined);
    await withPlatform("win32", () => createSymlink("/tmp/asm-target", "/tmp/asm-src"));
    expect(spy).toHaveBeenCalledWith("/tmp/asm-src", "/tmp/asm-target", "junction");
    vi.restoreAllMocks();
  });
});

describe("normalizeLinkTarget (AC2)", () => {
  test("strip \\\\?\\ 前缀", () => {
    expect(normalizeLinkTarget("\\\\?\\C:\\Users\\x")).toBe("C:\\Users\\x");
  });
  test("strip \\\\?\\UNC\\ 前缀为 \\\\host\\share", () => {
    expect(normalizeLinkTarget("\\\\?\\UNC\\host\\share")).toBe("\\\\host\\share");
  });
  test("无前缀不变", () => {
    expect(normalizeLinkTarget("/Users/x")).toBe("/Users/x");
    expect(normalizeLinkTarget("C:\\Users\\x")).toBe("C:\\Users\\x");
  });
});

describe("samePath 平台大小写 (AC4)", () => {
  test("linux 大小写敏感", () => {
    expect(withPlatform("linux", () => samePath("/Users/X", "/Users/x"))).toBe(false);
  });
  test("win32 大小写不敏感", () => {
    expect(withPlatform("win32", () => samePath("C:\\Users\\X", "C:\\users\\x"))).toBe(true);
  });
  test("darwin 大小写不敏感", () => {
    expect(withPlatform("darwin", () => samePath("/Users/X", "/Users/x"))).toBe(true);
  });
});

describe("assertSafeSkillName Windows 字符 (AC5)", () => {
  function capture(fn: () => void): unknown {
    try {
      fn();
      return null;
    } catch (e) {
      return e;
    }
  }
  test.each([":", "<", ">", '"', "|", "?", "*"])("拒绝 Windows 非法字符 %s", (ch) => {
    const err = capture(() => assertSafeSkillName(`bad${ch}name`));
    expect(isBizError(err)).toBe(true);
    expect((err as { code: string }).code).toBe("INVALID_SKILL_NAME");
  });
  test.each(["CON", "con", "PRN", "NUL", "COM1", "LPT9"])("拒绝 Windows 保留名 %s", (name) => {
    expect(() => assertSafeSkillName(name)).toThrow();
  });
  test("合法名通过", () => {
    expect(() => assertSafeSkillName("my-skill_1")).not.toThrow();
  });
});

describe("detectSystemLocale Intl (AC6)", () => {
  test("无 LANG 时 Intl 返回 zh-CN → zh-CN（不到 macOS 步骤）", () => {
    vi.stubEnv("LC_ALL", "");
    vi.stubEnv("LC_MESSAGES", "");
    vi.stubEnv("LANG", "");
    vi.stubGlobal("Intl", { DateTimeFormat: () => ({ resolvedOptions: () => ({ locale: "zh-CN" }) }) });
    try {
      expect(detectSystemLocale()).toBe("zh-CN");
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
});

describe("旧 state 兼容 (向后兼容)", () => {
  test("无 syncMethod 的旧 state 读取不报错", async () => {
    const dir = await mkTmp("asm-state-");
    const stateStore = new StateStore(dir);
    await fs.writeFile(
      path.join(dir, "state.json"),
      JSON.stringify({
        version: 1,
        installedSkills: {
          foo: {
            skillName: "foo",
            displayName: "foo",
            tags: [],
            ssotPath: path.join(dir, "foo"),
            source: { kind: "manual-import" },
            contentHash: "h",
            installedAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            enabledAgents: { pi: { agentId: "pi", targetPath: path.join(dir, "pi", "foo"), linkedAt: "2026-01-01T00:00:00Z" } }
          }
        }
      })
    );
    const state = await stateStore.read();
    expect(state.installedSkills.foo.enabledAgents.pi).toBeDefined();
    expect(state.installedSkills.foo.enabledAgents.pi.agentId).toBe("pi");
  });
});
