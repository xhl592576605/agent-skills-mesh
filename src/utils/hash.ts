import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function sha256File(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function sha256Directory(dirPath: string): Promise<string> {
  const files = await collectFiles(dirPath, dirPath);
  const hash = crypto.createHash("sha256");
  for (const file of files.sort((a, b) => a.relative.localeCompare(b.relative))) {
    hash.update(file.relative);
    hash.update("\0");
    hash.update(await fs.readFile(file.absolute));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const HASH_SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "__pycache__"]);

async function collectFiles(root: string, current: string): Promise<Array<{ absolute: string; relative: string }>> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files: Array<{ absolute: string; relative: string }> = [];
  for (const entry of entries) {
    if (entry.isDirectory() && HASH_SKIP_DIRS.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(root, absolute)));
    else if (entry.isFile()) files.push({ absolute, relative: path.relative(root, absolute).split(path.sep).join("/") });
  }
  return files;
}
