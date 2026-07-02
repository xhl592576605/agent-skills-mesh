import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitCloneOptions {
  branch?: string;
}

export interface GitPullResult {
  /** true 表示快进成功；false 表示非快进（调用方报告冲突，不自动 rebase/merge）。 */
  fastForward: boolean;
  /** 非快进或失败时的错误描述。 */
  error?: string;
}

/**
 * 执行 `git clone`。失败时抛出含 stderr 的 Error（调用方负责回滚半成品目录）。
 *
 * 用 node 内置 `node:child_process` 调系统 git，不引入 execa / isomorphic-git，
 * 与现有 utils 全用 node 内置模块（fs/crypto/path）的风格一致。
 */
export async function gitClone(url: string, dest: string, options: GitCloneOptions = {}): Promise<void> {
  const args = ["clone"];
  if (options.branch) args.push("--branch", options.branch);
  args.push(url, dest);
  try {
    await execFileAsync("git", args);
  } catch (error) {
    throw new Error(gitErrorMessage(error, `git clone ${url} -> ${dest}`));
  }
}

/**
 * 在 dir 中执行 `git pull --ff-only`。
 *
 * - exit 0 → `{ fastForward: true }`
 * - 非快进（输出含 "fast-forward"）→ `{ fastForward: false, error }`，不抛出
 * - 其它非零退出（网络/权限等）→ 抛出含 stderr 的 Error
 */
export async function gitPullFfOnly(dir: string): Promise<GitPullResult> {
  try {
    await execFileAsync("git", ["-C", dir, "pull", "--ff-only"]);
    return { fastForward: true };
  } catch (error) {
    const output = `${stderrOf(error)}\n${stdoutOf(error)}`;
    if (/fast-forward/i.test(output)) {
      return { fastForward: false, error: stderrOf(error).trim() || "pull was not a fast-forward" };
    }
    throw new Error(gitErrorMessage(error, `git -C ${dir} pull --ff-only`));
  }
}

function gitErrorMessage(error: unknown, command: string): string {
  const stderr = stderrOf(error).trim();
  const fallback = error instanceof Error ? error.message : String(error);
  return `${command} failed: ${stderr || fallback}`;
}

function stderrOf(error: unknown): string {
  return typeof (error as { stderr?: unknown }).stderr === "string" ? (error as { stderr: string }).stderr : "";
}

function stdoutOf(error: unknown): string {
  return typeof (error as { stdout?: unknown }).stdout === "string" ? (error as { stdout: string }).stdout : "";
}
