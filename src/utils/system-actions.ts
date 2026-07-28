import { spawn } from "node:child_process";

export type SystemCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<void>;

export interface SystemActionOptions {
  /** 测试注入；生产缺省使用当前平台。 */
  platform?: NodeJS.Platform;
  /** 测试注入；生产缺省使用无 shell 的 spawn。 */
  run?: SystemCommandRunner;
}

/**
 * 使用系统默认浏览器打开 http/https URL。
 *
 * 不通过 shell 拼接参数，避免 URL 中的特殊字符进入命令解释器。
 */
export async function openExternalUrl(rawUrl: string, options: SystemActionOptions = {}): Promise<void> {
  const url = assertExternalUrl(rawUrl);
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runSystemCommand;

  switch (platform) {
    case "darwin":
      await run("open", [url]);
      return;
    case "win32":
      await run("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
      return;
    case "linux":
    case "freebsd":
      await run("xdg-open", [url]);
      return;
    default:
      throw new Error(`Opening URLs is not supported on platform ${platform}`);
  }
}

function assertExternalUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid external URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Unsupported external URL protocol: ${parsed.protocol}`);
  }
  return parsed.toString();
}

function runSystemCommand(command: string, args: readonly string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}
