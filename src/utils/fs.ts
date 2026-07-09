import fs from "node:fs/promises";
import path from "node:path";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

/** 递归删除目录或文件；`force: true` 使目标不存在时不报错（用于回滚清理半成品）。 */
export async function removeRecursive(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
}

/** 分发方式：symlink（符号链接）或 copy（目录副本）。 */
export type LinkMethod = "symlink" | "copy";

/**
 * 跨平台创建「source → target」软连接。
 * Windows 用 junction（无需特权，只指目录绝对路径）；POSIX 用 symlink（type 被忽略）。
 * 调用方须保证 targetPath 不存在（先清理）。失败（路径错误等）原样抛出。
 */
export async function createSymlink(targetPath: string, sourcePath: string): Promise<void> {
  const type: "junction" | "dir" = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(sourcePath, targetPath, type);
}

/**
 * 规范化 readlink 结果：strip Windows 的 `\\?\` 与 `\\?\UNC\` 前缀。
 * junction / symlink 的 readlink 在 Windows 可能返回带前缀的路径，导致 samePath 误判。
 */
export function normalizeLinkTarget(raw: string): string {
  if (raw.startsWith("\\\\?\\UNC\\")) return "\\" + raw.slice(7);
  if (raw.startsWith("\\\\?\\")) return raw.slice(4);
  return raw;
}
