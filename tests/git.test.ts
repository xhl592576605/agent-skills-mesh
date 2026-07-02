import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { gitClone, gitPullFfOnly } from "../src/utils/git.js";
import { pathExists } from "../src/utils/fs.js";

const execFileAsync = promisify(execFile);

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function gitIn(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

async function commitIn(cwd: string, message: string): Promise<void> {
  await execFileAsync("git", ["-C", cwd, "commit", "-m", message]);
}

/** 用 `git init` 在临时目录建一个含一次提交的本地仓库（不联网）。 */
async function makeRemoteRepo(): Promise<string> {
  const dir = await tempDir("asm-git-remote-");
  await execFileAsync("git", ["init", dir]);
  await gitIn(["config", "user.email", "test@example.com"], dir);
  await gitIn(["config", "user.name", "Test"], dir);
  await fs.mkdir(path.join(dir, "my-skill"), { recursive: true });
  await fs.writeFile(path.join(dir, "my-skill", "SKILL.md"), "---\nname: my-skill\n---\nhello\n", "utf8");
  await gitIn(["add", "."], dir);
  await commitIn(dir, "initial");
  return dir;
}

describe("git utils", () => {
  test("gitClone clones a local repo into a fresh dir", async () => {
    const remote = await makeRemoteRepo();
    const dest = await tempDir("asm-git-clone-");
    await gitClone(remote, dest);

    expect(await pathExists(path.join(dest, ".git"))).toBe(true);
    expect(await fs.readFile(path.join(dest, "my-skill", "SKILL.md"), "utf8")).toContain("hello");
  });

  test("gitClone checks out the requested branch", async () => {
    const remote = await makeRemoteRepo();
    await gitIn(["checkout", "-b", "feature"], remote);
    await fs.writeFile(path.join(remote, "branch-only.txt"), "feature", "utf8");
    await gitIn(["add", "."], remote);
    await commitIn(remote, "feature");

    const dest = await tempDir("asm-git-branch-");
    await gitClone(remote, dest, { branch: "feature" });

    expect(await fs.readFile(path.join(dest, "branch-only.txt"), "utf8")).toBe("feature");
  });

  test("gitClone throws an error containing the command on failure", async () => {
    const dest = await tempDir("asm-git-bad-");
    await expect(gitClone("/nonexistent/path/asm-xyz", dest)).rejects.toThrow(/git clone/);
  });

  test("gitPullFfOnly fast-forwards when remote has new commits", async () => {
    const remote = await makeRemoteRepo();
    const work = await tempDir("asm-git-ff-");
    await gitClone(remote, work);

    await fs.writeFile(path.join(remote, "my-skill", "SKILL.md"), "---\nname: my-skill\n---\nv2\n", "utf8");
    await gitIn(["add", "."], remote);
    await commitIn(remote, "v2");

    const result = await gitPullFfOnly(work);
    expect(result.fastForward).toBe(true);
    expect(result.error).toBeUndefined();
    expect(await fs.readFile(path.join(work, "my-skill", "SKILL.md"), "utf8")).toContain("v2");
  });

  test("gitPullFfOnly reports non-fast-forward without throwing", async () => {
    const remote = await makeRemoteRepo();
    const work = await tempDir("asm-git-noff-");
    await gitClone(remote, work);

    // remote 与 work 各自产生分叉提交
    await fs.writeFile(path.join(remote, "my-skill", "SKILL.md"), "---\nname: my-skill\n---\nremote\n", "utf8");
    await gitIn(["add", "."], remote);
    await commitIn(remote, "remote");

    await gitIn(["config", "user.email", "test@example.com"], work);
    await gitIn(["config", "user.name", "Test"], work);
    await fs.writeFile(path.join(work, "my-skill", "SKILL.md"), "---\nname: my-skill\n---\nlocal\n", "utf8");
    await gitIn(["add", "."], work);
    await commitIn(work, "local");

    const result = await gitPullFfOnly(work);
    expect(result.fastForward).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test("gitPullFfOnly throws on a non-git directory", async () => {
    const notARepo = await tempDir("asm-git-nogit-");
    await expect(gitPullFfOnly(notARepo)).rejects.toThrow(/pull --ff-only/);
  });
});
