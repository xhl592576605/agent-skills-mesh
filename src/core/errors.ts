/**
 * 业务错误码体系（design §5.1）。
 *
 * core 层不依赖 i18n 字典：业务错误以 {@link bizError} 创建——普通 `Error` 实例附加
 * `code` / `params` 属性（**非子类**，符合 `backend/error-handling.md`「禁止自定义 Error
 * 继承层级，除非调用方需要无法用既有 typed status 表达的程序化分支」的例外）。UI 层
 * （cli/tui）通过 {@link isBizError} 鸭子类型检测后，用 i18n 的 `formatError()` 按
 * `err.<code>` 翻译；i18n 模块本身不 import 本文件，保持 Phase A 独立可测。
 *
 * `message` 保留英文兜底，供日志、非 i18n 场景与 `--lang en` 排错。
 */

/**
 * 业务错误码。与 `src/i18n/en.ts` / `zh-CN.ts` 的 `err.<CODE>` key 一一对应——
 * 新增 code 时必须同步追加两份字典条目（字典完整性测试保证 key 集合一致）。
 */
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
  | "INVALID_TOML"
  | "COPIED_SKILL_INVALID"
  | "SSOT_TARGET_NOT_DIRECTORY"
  | "SSOT_TARGET_EXISTS"
  | "CONFIG_NOT_FOUND"
  // source-service 业务错误（W1 补齐）
  | "SOURCE_PATH_NOT_EXIST"
  | "SOURCE_PATH_NOT_DIRECTORY"
  | "SOURCE_ALREADY_REGISTERED"
  | "SOURCE_NOT_SKILL_DIR"
  | "GIT_REPO_ALREADY_REGISTERED"
  | "REPO_TARGET_EXISTS"
  | "PURGE_REFUSED_NOT_UNDER_REPOS"
  | "SOURCE_ID_EXISTS"
  | "SOURCE_ID_UNKNOWN"
  // skill-service 业务错误（W1 补齐）
  | "SKILL_ALREADY_INSTALLED"
  | "SKILL_NOT_IN_INDEX"
  | "SKILL_NO_CANDIDATE"
  | "SKILL_MULTIPLE_CANDIDATES"
  | "SKILL_NOT_INSTALLED"
  | "SOURCE_NOT_PROVIDE_SKILL"
  | "CANDIDATE_NOT_CONFIGURED_SOURCE"
  // agent-service 业务错误（W1 补齐）
  | "AGENT_ID_INVALID"
  | "AGENT_ALREADY_EXISTS"
  | "AGENT_BUILTIN_NO_REMOVE";

/**
 * 带 `code` / `params` 的 `Error`（非子类）。`params` 供 UI 层 `{{name}}` 插值翻译。
 */
export type BizError = Error & {
  code: ErrorCode;
  params: Record<string, string | number>;
};

/**
 * 创建带错误码的 `Error`（仍是 `Error` 实例，非子类）。
 *
 * @param code    业务错误码（对应字典 `err.<code>`）
 * @param params  插值参数（与字典 `{{param}}` 同名）
 * @param message 英文兜底 message（默认为 code 本身），供日志与非 i18n 场景
 */
export function bizError(
  code: ErrorCode,
  params: Record<string, string | number> = {},
  message?: string,
): BizError {
  const err = new Error(message ?? code) as BizError;
  err.code = code;
  err.params = params;
  return err;
}

/** 鸭子类型守卫：`Error` 实例且带字符串 `code` 即视为业务错误。 */
export function isBizError(e: unknown): e is BizError {
  return e instanceof Error && typeof (e as { code?: unknown }).code === "string";
}
