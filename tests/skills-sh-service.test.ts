/**
 * skills.sh 搜索客户端 + GitHub identity helper 测试（implement.md 阶段 1 验证点）。
 *
 * 覆盖：正常映射、非 GitHub/穿越过滤、URL 编码、2 字符阈值、timeout、HTTP/非法 JSON/
 * schema drift typed error、abort、空结果，并证明客户端不发送 offset、不把 count 当全量总数。
 * 全程注入 fetchImpl，绝不访问真实网络。
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  SKILLS_SH_ENDPOINT,
  SKILLS_SH_MIN_QUERY_LENGTH,
  SKILLS_SH_REQUEST_TIMEOUT_MS,
  SKILLS_SH_SEARCH_LIMIT,
  findCanonicalGitHubSources,
  parseGitHubRepoUrl,
  parseSkillsShGitHubSource,
  parseSkillsShResponse,
  searchSkillsSh,
  type FetchImpl,
} from "../src/core/services/skills-sh-service.js";
import { createDefaultConfig } from "../src/core/storage/config-store.js";
import { isBizError } from "../src/core/errors.js";

/** 构造最小可用 Response（仅满足 searchSkillsSh 读取路径）。 */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** 注入式 fetch：把 (url, init) 交给回调，便于断言请求参数。 */
function fetchFrom(callback: (url: string, init?: RequestInit) => Promise<Response> | Response): FetchImpl {
  return ((url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(callback(typeof url === "string" ? url : url.toString(), init))) as FetchImpl;
}

function okResponse(skills: unknown[], extra: Partial<{ query: string; searchType: string; count: number; duration_ms: number }> = {}): unknown {
  return {
    query: extra.query ?? "demo",
    searchType: extra.searchType ?? "semantic",
    skills,
    count: extra.count ?? skills.length,
    duration_ms: extra.duration_ms ?? 12,
  };
}

async function expectBizCode(p: Promise<unknown>, code: string): Promise<void> {
  const e = await p.catch((x: unknown) => x);
  expect(isBizError(e)).toBe(true);
  expect((e as { code?: unknown }).code).toBe(code);
}

// === GitHub source parser ===
describe("parseSkillsShGitHubSource", () => {
  test("accepts strict owner/repo", () => {
    const ref = parseSkillsShGitHubSource("anthropics/courses");
    expect(ref).toBeDefined();
    expect(ref!.owner).toBe("anthropics");
    expect(ref!.repo).toBe("courses");
    expect(ref!.key).toBe("github:anthropics/courses");
    expect(ref!.cloneUrl).toBe("https://github.com/anthropics/courses.git");
  });

  test("is case-preserving but key is lowercase", () => {
    const ref = parseSkillsShGitHubSource("OpenAI/Skill-Repo");
    expect(ref).toBeDefined();
    expect(ref!.owner).toBe("OpenAI");
    expect(ref!.repo).toBe("Skill-Repo");
    expect(ref!.key).toBe("github:openai/skill-repo");
  });

  test.each([
    ["https://github.com/a/b", "protocol URL"],
    ["git@github.com:a/b", "scp/ssh"],
    ["a/b/c", "three segments"],
    ["a", "single segment"],
    ["/a/b", "leading slash"],
    ["a/b/", "trailing slash"],
    ["a.b/c", "domain-like owner"],
    ["a/b.git", "trailing .git"],
    ["a/../b", "traversal"],
    [".", "dot"],
    ["..", "dotdot"],
    ["a/b\\c", "backslash"],
    ["a/b?x=1", "query"],
    ["a/b#frag", "fragment"],
    ["-a/b", "leading hyphen owner"],
    ["a/-b", "leading hyphen repo"],
    ["", "empty"],
    ["   ", "whitespace"],
    ["a / b", "internal whitespace"],
  ])("rejects invalid source %q (%s)", (input: string) => {
    expect(parseSkillsShGitHubSource(input)).toBeUndefined();
  });
});

// === GitHub URL canonical parser ===
describe("parseGitHubRepoUrl", () => {
  test.each([
    ["https://github.com/anthropics/courses", "anthropics", "courses"],
    ["https://github.com/anthropics/courses.git", "anthropics", "courses"],
    ["https://github.com/anthropics/courses/", "anthropics", "courses"],
    ["https://github.com/OpenAI/Skill.Repo", "OpenAI", "Skill.Repo"],
    ["http://github.com/a/b", "a", "b"],
    ["git@github.com:a/b", "a", "b"],
    ["git@github.com:a/b.git", "a", "b"],
    ["ssh://git@github.com/a/b", "a", "b"],
    ["ssh://git@github.com/a/b.git", "a", "b"],
  ])("parses %s -> owner=%s repo=%s", (url, owner, repo) => {
    const ref = parseGitHubRepoUrl(url);
    expect(ref).toBeDefined();
    expect(ref!.owner).toBe(owner);
    expect(ref!.repo).toBe(repo);
    expect(ref!.key).toBe(`github:${owner.toLowerCase()}/${repo.toLowerCase()}`);
  });

  test.each([
    ["https://gitlab.com/a/b", "non-github host"],
    ["https://github.com/a", "single segment"],
    ["https://github.com/a/b/c", "three segments"],
    ["git@gitlab.com:a/b", "non-github scp"],
    ["", "empty"],
    ["not a url", "garbage"],
  ])("rejects %s (%s)", (url: string) => {
    expect(parseGitHubRepoUrl(url)).toBeUndefined();
  });
});

// === findCanonicalGitHubSources ===
describe("findCanonicalGitHubSources", () => {
  test("matches by canonical key across url variants", () => {
    const config = createDefaultConfig();
    config.sources = [
      { id: "s1", name: "x", type: "git-repo", path: "/p1", enabled: true, url: "https://github.com/Anthropics/Courses.git" },
      { id: "s2", name: "y", type: "git-repo", path: "/p2", enabled: true, url: "git@github.com:anthropics/courses" },
      { id: "s3", name: "z", type: "git-repo", path: "/p3", enabled: true, url: "https://github.com/other/repo" },
      { id: "s4", name: "local", type: "local-dir", path: "/p4", enabled: true },
    ];
    const matches = findCanonicalGitHubSources(config, "github:anthropics/courses");
    expect(matches.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  test("returns empty when no match", () => {
    const config = createDefaultConfig();
    config.sources = [];
    expect(findCanonicalGitHubSources(config, "github:a/b")).toEqual([]);
  });
});

// === searchSkillsSh request contract ===
describe("searchSkillsSh request contract", () => {
  test("sends GET <endpoint>?q=<encoded>&limit=50 and never sends offset", async () => {
    let capturedUrl = "";
    const result = await searchSkillsSh({
      query: "rust cli",
      fetchImpl: fetchFrom((url) => {
        capturedUrl = url;
        return jsonResponse(okResponse([]));
      }),
    });
    expect(result.items).toEqual([]);
    expect(capturedUrl).toBe(`${SKILLS_SH_ENDPOINT}?q=${encodeURIComponent("rust cli")}&limit=${SKILLS_SH_SEARCH_LIMIT}`);
    expect(capturedUrl).not.toContain("offset");
  });

  test("rejects query shorter than 2 chars (after trim)", async () => {
    await expectBizCode(searchSkillsSh({ query: "a", fetchImpl: fetchFrom(() => jsonResponse(okResponse([]))) }), "SKILLS_SH_QUERY_TOO_SHORT");
    await expectBizCode(searchSkillsSh({ query: "   a  ", fetchImpl: fetchFrom(() => jsonResponse(okResponse([]))) }), "SKILLS_SH_QUERY_TOO_SHORT");
    expect(SKILLS_SH_MIN_QUERY_LENGTH).toBe(2);
  });

  test("two-char query is accepted", async () => {
    const result = await searchSkillsSh({ query: "ab", fetchImpl: fetchFrom(() => jsonResponse(okResponse([]))) });
    expect(result.items).toEqual([]);
  });
});

// === response parsing ===
describe("parseSkillsShResponse mapping & filtering", () => {
  test("maps fields and keeps only GitHub owner/repo entries", () => {
    const parsed = parseSkillsShResponse(
      okResponse([
        { id: "1", skillId: "foo", name: "Foo", installs: 10, source: "anthropics/courses" },
        { id: "2", skillId: "bar", name: "Bar", installs: 3, source: "gitlab.com/a/b" },
        { id: "3", skillId: "baz", name: "Baz", installs: 0, source: "owner/repo/extra" },
        { id: "4", skillId: "qux", name: "Qux", installs: 1, source: "openai/skill-repo" },
      ]),
    );
    expect(parsed.items.map((i) => i.skillId)).toEqual(["foo", "qux"]);
    expect(parsed.items[0]).toMatchObject({
      provider: "skills.sh",
      id: "1",
      skillId: "foo",
      name: "Foo",
      installs: 10,
      source: "anthropics/courses",
    });
    expect(parsed.items[0].repository.key).toBe("github:anthropics/courses");
    expect(parsed.items[0].repository.cloneUrl).toBe("https://github.com/anthropics/courses.git");
    // count 仅作一致性信息，不作为全量总数。
    expect(parsed.returnedCount).toBe(4);
  });

  test("empty skills array yields empty items (not an error)", () => {
    const parsed = parseSkillsShResponse(okResponse([]));
    expect(parsed.items).toEqual([]);
  });

  test("each entry strict-typed: bad-type fields are filtered, not thrown", () => {
    const parsed = parseSkillsShResponse(
      okResponse([
        { id: "1", skillId: "foo", name: "Foo", installs: "10", source: "a/b" }, // installs not number
        { id: "2", skillId: "", name: "Empty", installs: 1, source: "a/b" }, // empty skillId
        { id: "3", skillId: "ok", name: "Ok", installs: 1, source: "a/b" },
      ]),
    );
    expect(parsed.items.map((i) => i.skillId)).toEqual(["ok"]);
  });
});

describe("parseSkillsShResponse schema drift", () => {
  function expectSyncBizCode(fn: () => unknown, code: string): void {
    try {
      fn();
      throw new Error("expected parseSkillsShResponse to throw");
    } catch (e) {
      expect(isBizError(e)).toBe(true);
      expect((e as { code?: unknown }).code).toBe(code);
    }
  }

  test.each([
    ["not an object", "array" as unknown],
    ["not an object", 42 as unknown],
    ["missing query", { searchType: "x", skills: [], count: 0, duration_ms: 1 }],
    ["query not string", { query: 1, searchType: "x", skills: [], count: 0, duration_ms: 1 }],
    ["skills not array", { query: "q", searchType: "x", skills: {}, count: 0, duration_ms: 1 }],
    ["count not finite", { query: "q", searchType: "x", skills: [], count: NaN, duration_ms: 1 }],
    ["duration_ms not finite", { query: "q", searchType: "x", skills: [], count: 0, duration_ms: Infinity }],
  ])("throws SKILLS_SH_INVALID_RESPONSE for %s", (_label, body) => {
    expectSyncBizCode(() => parseSkillsShResponse(body), "SKILLS_SH_INVALID_RESPONSE");
  });
});

// === HTTP / network / timeout errors ===
describe("searchSkillsSh error handling", () => {
  test("non-2xx HTTP -> SKILLS_SH_UNAVAILABLE (kind=http, status)", async () => {
    let capturedUrl = "";
    const e = await searchSkillsSh({
      query: "demo",
      fetchImpl: fetchFrom((url) => {
        capturedUrl = url;
        return jsonResponse(okResponse([]), 500);
      }),
    }).catch((x: unknown) => x);
    void capturedUrl;
    expect(isBizError(e)).toBe(true);
    expect((e as { code: string }).code).toBe("SKILLS_SH_UNAVAILABLE");
    expect((e as { params: Record<string, unknown> }).params).toMatchObject({ kind: "http", status: 500 });
  });

  test("network failure -> SKILLS_SH_UNAVAILABLE (kind=network)", async () => {
    const e = await searchSkillsSh({
      query: "demo",
      fetchImpl: fetchFrom(() => Promise.reject(new Error("ECONNRESET"))),
    }).catch((x: unknown) => x);
    expect(isBizError(e)).toBe(true);
    expect((e as { code: string }).code).toBe("SKILLS_SH_UNAVAILABLE");
    expect((e as { params: Record<string, unknown> }).params).toMatchObject({ kind: "network" });
  });

  test("invalid JSON body -> SKILLS_SH_INVALID_RESPONSE (reason=json)", async () => {
    const e = await searchSkillsSh({
      query: "demo",
      fetchImpl: fetchFrom(() => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Unexpected token");
        },
      } as Response)),
    }).catch((x: unknown) => x);
    expect(isBizError(e)).toBe(true);
    expect((e as { code: string }).code).toBe("SKILLS_SH_INVALID_RESPONSE");
    expect((e as { params: Record<string, unknown> }).params).toMatchObject({ reason: "json" });
  });

  test("schema-drift body -> SKILLS_SH_INVALID_RESPONSE (reason=<field>)", async () => {
    const e = await searchSkillsSh({
      query: "demo",
      fetchImpl: fetchFrom(() => jsonResponse({ query: "demo", searchType: "x", skills: [], count: "0", duration_ms: 1 })),
    }).catch((x: unknown) => x);
    expect(isBizError(e)).toBe(true);
    expect((e as { code: string }).code).toBe("SKILLS_SH_INVALID_RESPONSE");
    expect((e as { params: Record<string, unknown> }).params).toMatchObject({ reason: "count" });
  });

  test("empty result is not an error", async () => {
    const result = await searchSkillsSh({
      query: "zzz",
      fetchImpl: fetchFrom(() => jsonResponse(okResponse([]))),
    });
    expect(result.items).toEqual([]);
  });
});

// === abort semantics (caller signal) ===
describe("searchSkillsSh abort", () => {
  test("pre-aborted caller signal -> aborts (non-biz) without calling fetch", async () => {
    let called = false;
    const ac = new AbortController();
    ac.abort();
    const e = await searchSkillsSh({
      query: "demo",
      signal: ac.signal,
      fetchImpl: fetchFrom(() => {
        called = true;
        return jsonResponse(okResponse([]));
      }),
    }).catch((x: unknown) => x);
    expect(isBizError(e)).toBe(false);
    expect((e as Error).name).toBe("AbortError");
    expect(called).toBe(false);
  });

  test("aborting during fetch -> abort error (not SKILLS_SH_UNAVAILABLE)", async () => {
    const caller = new AbortController();
    const e = await searchSkillsSh({
      query: "demo",
      signal: caller.signal,
      fetchImpl: fetchFrom((_url, init) =>
        new Promise((resolve, reject) => {
          // 当请求 signal 触发时模拟 fetch 抛出 AbortError。
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          caller.abort();
          // 兜底：若未触发，1s 后返回空结果。
          setTimeout(() => resolve(jsonResponse(okResponse([]))), 1000);
        }),
      ),
    }).catch((x: unknown) => x);
    expect(isBizError(e)).toBe(false);
    expect((e as Error).name).toBe("AbortError");
  });
});

// === timeout (fake timers) ===
describe("searchSkillsSh timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("timeout -> SKILLS_SH_UNAVAILABLE (kind=timeout) and never resolves fetch", async () => {
    vi.useFakeTimers();
    let fetchSignal: AbortSignal | undefined;
    // fetch 永不自行 resolve；只在请求 signal abort 时 reject（模拟真实 fetch 行为）。
    const neverResolvingFetch = fetchFrom((_url, init) => {
      fetchSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const pending = searchSkillsSh({ query: "demo", fetchImpl: neverResolvingFetch }).catch((x: unknown) => x);
    // 推进到超时应触发 timeout。
    await vi.advanceTimersByTimeAsync(SKILLS_SH_REQUEST_TIMEOUT_MS);
    const e = await pending;
    expect(fetchSignal?.aborted).toBe(true);
    expect(isBizError(e)).toBe(true);
    expect((e as { code: string }).code).toBe("SKILLS_SH_UNAVAILABLE");
    expect((e as { params: Record<string, unknown> }).params).toMatchObject({ kind: "timeout", ms: SKILLS_SH_REQUEST_TIMEOUT_MS });
  });
});
