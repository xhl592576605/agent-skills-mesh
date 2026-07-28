/**
 * skills.sh 公共搜索客户端 + GitHub 仓库身份规范化（design §3 / §4.1 / §4.2）。
 *
 * 本文件只负责「发现」：构造固定请求、严格解析响应、过滤非 GitHub 条目、规范化仓库身份。
 * 不写本地文件系统、不 import TUI / i18n / stores；所有失败以 `bizError` 抛出（英文兜底）。
 *
 * 公共端点契约（已实测，未写入 skills.sh 新版文档）：
 *   GET https://skills.sh/api/search?q=<enc>&limit=50
 * - 不发送 OIDC token，不执行 `npx skills`。
 * - 公共端点忽略 `offset`，`count` 只是本次返回条数而非目录总量 → 客户端**不**发送 offset、
 *   **不**把 count 当作全量总数；TUI 在已获取的 Top 50 上做本地分页。
 */
import type { AppConfig, SourceConfig } from "../models/config.js";
import { bizError } from "../errors.js";

/** skills.sh 公共搜索固定端点。 */
export const SKILLS_SH_ENDPOINT = "https://skills.sh/api/search";
/** 查询词最小长度（trim 后），少于该值不发请求。 */
export const SKILLS_SH_MIN_QUERY_LENGTH = 2;
/** 固定拉取 Top N；TUI 在此基础上做每页 10 条本地分页。 */
export const SKILLS_SH_SEARCH_LIMIT = 50;
/** 请求超时（毫秒）。 */
export const SKILLS_SH_REQUEST_TIMEOUT_MS = 10_000;

/**
 * skills.sh 原始响应契约（design §3）。只接受下列字段类型；顶层字段缺失或类型错误
 * 一律视为响应结构变化（`SKILLS_SH_INVALID_RESPONSE`）。
 */
export interface SkillsShRawResponse {
  query: string;
  searchType: string;
  skills: Array<{
    id: string;
    skillId: string;
    name: string;
    installs: number;
    source: string;
  }>;
  count: number;
  duration_ms: number;
}

/** 规范化的 GitHub 仓库身份。`key` 大小写不敏感，用于 source 复用匹配。 */
export interface GitHubRepoRef {
  owner: string;
  repo: string;
  /** `github:<lower-owner>/<lower-repo>`，规范化匹配键。 */
  key: string;
  /** Core 从校验后的 owner/repo 构造的固定 HTTPS clone URL。 */
  cloneUrl: string;
}

/**
 * skills.sh 单条结果对外引用（design §3）。
 *
 * - `id` 仅用于结果追踪/诊断，**不**与 ASM candidate.id 比较。
 * - `skillId` 是本地候选匹配键（与扫描后的 `candidate.skillName` 精确相等）。
 * - `name` 仅展示，不作为路径或安装键。
 * - `source` 必须严格为 `owner/repo`；clone URL 只能由 Core 从校验后的 owner/repo 构造。
 */
export interface SkillsShSkillRef {
  provider: "skills.sh";
  id: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
  repository: GitHubRepoRef;
}

/** skills.sh 搜索结果。`returnedCount` 仅是响应一致性信息，不是全量目录总量。 */
export interface SkillsShSearchResult {
  query: string;
  searchType: string;
  items: SkillsShSkillRef[];
  /** 响应里的 `count`，仅作一致性信息；不作为全量总数。 */
  returnedCount: number;
  durationMs: number;
}

/** fetch 函数类型（便于测试注入）。与全局 `fetch` 形态一致。 */
export type FetchImpl = typeof fetch;

export interface SearchSkillsShOptions {
  query: string;
  /** 调用方取消信号；触发时以 abort（非用户错误）形式抛出，由上层静默处理。 */
  signal?: AbortSignal;
  /** 注入 fetch（测试用）；缺省使用全局 fetch。 */
  fetchImpl?: FetchImpl;
}

/**
 * 严格解析 skills.sh `source` 字段为 GitHub `owner/repo` 身份。
 *
 * 拒绝：协议 URL、域名（含 `.`）、反斜杠、`.` / `..`、非两段路径、query/fragment、
 * 以及不符合 GitHub 命名规则的 owner/repo。repo 名按 PRD 严格规则不含 `.`。
 */
export function parseSkillsShGitHubSource(source: string): GitHubRepoRef | undefined {
  if (typeof source !== "string") return undefined;
  const trimmed = source.trim();
  if (!trimmed) return undefined;
  // 拒绝协议 URL、反斜杠、域名（owner/repo 不含 `.`）。
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) return undefined;
  if (trimmed.includes("\\")) return undefined;
  if (trimmed.includes(".")) return undefined;
  if (trimmed.includes("?") || trimmed.includes("#")) return undefined;
  const segments = trimmed.split("/");
  if (segments.length !== 2) return undefined;
  const owner = segments[0];
  const repo = segments[1];
  if (!owner || !repo) return undefined;
  if (owner === "." || owner === ".." || repo === "." || repo === "..") return undefined;
  // GitHub username: 字母数字开头，可含单连字符，不以连字符开头/结尾，<=39 字符。
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner)) return undefined;
  if (owner.length > 39) return undefined;
  // repo 名（PRD 严格）：字母数字开头，可含 `_` `-`（不含 `.`，已在前面过滤）。
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/.test(repo)) return undefined;
  if (repo.length > 100) return undefined;
  return buildGitHubRepoRef(owner, repo);
}

/**
 * 解析 GitHub URL（HTTPS / SSH / scp / 尾随 `.git` / 尾随 `/`）为规范化仓库身份。
 * 非 GitHub、路径段不足或非法均返回 `undefined`。
 */
export function parseGitHubRepoUrl(url: string): GitHubRepoRef | undefined {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  let owner = "";
  let repo = "";
  // HTTPS: https://github.com/owner/repo[.git][/]
  const https = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (https) {
    owner = https[1];
    repo = https[2];
  } else {
    // SSH / scp: git@github.com:owner/repo[.git] 或 ssh://git@github.com/owner/repo[.git]
    const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(trimmed);
    if (ssh) {
      owner = ssh[1];
      repo = ssh[2];
    } else {
      const sshProto = /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(trimmed);
      if (sshProto) {
        owner = sshProto[1];
        repo = sshProto[2];
      }
    }
  }
  if (!owner || !repo) return undefined;
  // 复用 source parser 的命名规则校验（注意：repo 可能含 `.`，此处剥离 `.git` 后保留合法 `.`）。
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner)) return undefined;
  if (owner.length > 39) return undefined;
  // repo 允许字母数字、`_` `-` `.`，但不能以 `.` 开头/结尾。
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(repo)) return undefined;
  if (repo.length > 100) return undefined;
  return buildGitHubRepoRef(owner, repo);
}

/** 构造规范化 GitHubRepoRef（owner/repo 大小写不敏感的 key + 固定 HTTPS clone URL）。 */
function buildGitHubRepoRef(owner: string, repo: string): GitHubRepoRef {
  return {
    owner,
    repo,
    key: `github:${owner.toLowerCase()}/${repo.toLowerCase()}`,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  };
}

/**
 * 在 config.sources 中查找与给定 canonical key 匹配的 git-repo source（design §4.2 复用规则）。
 *
 * 匹配按 GitHub URL 规范化（HTTPS / `.git` / SSH / scp / 大小写）后比较 key，不依赖 URL 完全相等。
 * 返回所有 canonical 相同的 source（可能为 0/1/N，调用方决定 create / reuse / ambiguous）。
 */
export function findCanonicalGitHubSources(config: AppConfig, key: string): SourceConfig[] {
  const matches: SourceConfig[] = [];
  for (const source of config.sources) {
    if (source.type !== "git-repo") continue;
    if (!source.url) continue;
    const ref = parseGitHubRepoUrl(source.url);
    if (ref && ref.key === key) matches.push(source);
  }
  return matches;
}

/**
 * 调用 skills.sh 公共搜索端点，严格解析并过滤非 GitHub 条目。
 *
 * - trim 后 query 少于 {@link SKILLS_SH_MIN_QUERY_LENGTH} → `SKILLS_SH_QUERY_TOO_SHORT`。
 * - 调用方 abort → 以 abort 形式抛出（非 bizError），由上层静默处理。
 * - 超时 / HTTP 非 2xx / 网络错误 → `SKILLS_SH_UNAVAILABLE`（params.kind: timeout|http|network）。
 * - 顶层字段缺失或类型错误 / JSON 非法 → `SKILLS_SH_INVALID_RESPONSE`。
 * - 不发送 offset，不把 count 当全量总数。
 */
export async function searchSkillsSh(options: SearchSkillsShOptions): Promise<SkillsShSearchResult> {
  const query = options.query.trim();
  if (query.length < SKILLS_SH_MIN_QUERY_LENGTH) {
    throw bizError("SKILLS_SH_QUERY_TOO_SHORT", { length: SKILLS_SH_MIN_QUERY_LENGTH }, `skills.sh query too short (min ${SKILLS_SH_MIN_QUERY_LENGTH} chars)`);
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw bizError("SKILLS_SH_UNAVAILABLE", { kind: "network" }, "skills.sh search unavailable: fetch is not available in this runtime");
  }
  const url = `${SKILLS_SH_ENDPOINT}?q=${encodeURIComponent(query)}&limit=${SKILLS_SH_SEARCH_LIMIT}`;

  // 手动合并 timeout signal 与调用方 signal（避免依赖 AbortSignal.any 的运行时差异）。
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(new Error("skills.sh request timeout")), SKILLS_SH_REQUEST_TIMEOUT_MS);
  const callerSignal = options.signal;
  const onCallerAbort = (): void => timeoutController.abort(callerSignal?.reason ?? new Error("aborted"));
  if (callerSignal) {
    if (callerSignal.aborted) timeoutController.abort(callerSignal.reason ?? new Error("aborted"));
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  let response: Response;
  // 调用方在发起请求前已取消 → 直接抛 abort，不浪费请求。
  if (callerSignal?.aborted) {
    clearTimeout(timer);
    throw toAbortError(callerSignal.reason);
  }
  try {
    response = await fetchImpl(url, { signal: timeoutController.signal, headers: { accept: "application/json" } });
  } catch (error) {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener("abort", onCallerAbort);
    const callerAborted = Boolean(callerSignal?.aborted);
    const timedOut = timeoutController.signal.aborted && !callerAborted;
    if (timedOut) {
      throw bizError("SKILLS_SH_UNAVAILABLE", { kind: "timeout", ms: SKILLS_SH_REQUEST_TIMEOUT_MS }, `skills.sh request timed out after ${SKILLS_SH_REQUEST_TIMEOUT_MS}ms`);
    }
    if (callerAborted) {
      // 调用方主动取消：抛 abort（非 bizError），上层静默处理。
      throw toAbortError(callerSignal?.reason ?? error);
    }
    throw bizError("SKILLS_SH_UNAVAILABLE", { kind: "network", message: errorMessage(error) }, `skills.sh network error: ${errorMessage(error)}`);
  }
  clearTimeout(timer);
  if (callerSignal) callerSignal.removeEventListener("abort", onCallerAbort);

  // 调用方可能在 fetch 完成后、读 body 前取消。
  if (callerSignal?.aborted) throw toAbortError(callerSignal.reason);

  if (!response.ok) {
    throw bizError("SKILLS_SH_UNAVAILABLE", { kind: "http", status: response.status }, `skills.sh request failed: HTTP ${response.status}`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    throw bizError("SKILLS_SH_INVALID_RESPONSE", { reason: "json" }, `skills.sh response is not valid JSON: ${errorMessage(error)}`);
  }
  return parseSkillsShResponse(json);
}

/** 严格解析 skills.sh 响应；顶层字段缺失/类型错误 → typed error，skills 数组单条严格过滤。 */
export function parseSkillsShResponse(data: unknown): SkillsShSearchResult {
  if (!isRecord(data)) {
    throw bizError("SKILLS_SH_INVALID_RESPONSE", { reason: "shape" }, "skills.sh response is not a JSON object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.query !== "string") {
    throw bizError("SKILLS_SH_INVALID_RESPONSE", { reason: "query" }, "skills.sh response field `query` missing or not a string");
  }
  if (typeof raw.searchType !== "string") {
    throw bizError("SKILLS_SH_INVALID_RESPONSE", { reason: "searchType" }, "skills.sh response field `searchType` missing or not a string");
  }
  if (!Array.isArray(raw.skills)) {
    throw bizError("SKILLS_SH_INVALID_RESPONSE", { reason: "skills" }, "skills.sh response field `skills` missing or not an array");
  }
  if (typeof raw.count !== "number" || !Number.isFinite(raw.count)) {
    throw bizError("SKILLS_SH_INVALID_RESPONSE", { reason: "count" }, "skills.sh response field `count` missing or not a finite number");
  }
  if (typeof raw.duration_ms !== "number" || !Number.isFinite(raw.duration_ms)) {
    throw bizError("SKILLS_SH_INVALID_RESPONSE", { reason: "duration_ms" }, "skills.sh response field `duration_ms` missing or not a finite number");
  }

  const items: SkillsShSkillRef[] = [];
  for (const entry of raw.skills) {
    const ref = parseSkillEntry(entry);
    if (ref) items.push(ref);
  }
  return {
    query: raw.query,
    searchType: raw.searchType,
    items,
    returnedCount: raw.count,
    durationMs: raw.duration_ms,
  };
}

/** 严格解析单条 skill：必要字段类型校验 + GitHub source 过滤；任一不过返回 `undefined`（过滤）。 */
function parseSkillEntry(entry: unknown): SkillsShSkillRef | undefined {
  if (!isRecord(entry)) return undefined;
  const e = entry as Record<string, unknown>;
  if (typeof e.id !== "string" || !e.id) return undefined;
  if (typeof e.skillId !== "string" || !e.skillId) return undefined;
  if (typeof e.name !== "string") return undefined;
  if (typeof e.installs !== "number" || !Number.isFinite(e.installs)) return undefined;
  if (typeof e.source !== "string" || !e.source) return undefined;
  const repository = parseSkillsShGitHubSource(e.source);
  if (!repository) return undefined; // 非 GitHub / 非法 source：过滤。
  return {
    provider: "skills.sh",
    id: e.id,
    skillId: e.skillId,
    name: e.name,
    installs: e.installs,
    source: e.source,
    repository,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 把任意 reason 包装成 abort 错误（非 bizError），供上层用 `signal.aborted` 静默处理。 */
function toAbortError(reason: unknown): Error {
  // 不直接返回 reason（DOMException 在部分运行时不 instanceof Error），统一造 name=AbortError 的 Error。
  const message = reason instanceof Error && reason.message ? reason.message : "aborted";
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}
