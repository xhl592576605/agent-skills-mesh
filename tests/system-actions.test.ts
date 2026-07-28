import { describe, expect, test, vi } from "vitest";
import {
  openExternalUrl,
  type SystemCommandRunner,
} from "../src/utils/system-actions.js";

function runner(): ReturnType<typeof vi.fn<SystemCommandRunner>> {
  return vi.fn<SystemCommandRunner>().mockResolvedValue(undefined);
}

describe("openExternalUrl", () => {
  test.each([
    ["darwin", "open", ["https://skills.sh/owner/repo/skill"]],
    ["linux", "xdg-open", ["https://skills.sh/owner/repo/skill"]],
    ["freebsd", "xdg-open", ["https://skills.sh/owner/repo/skill"]],
    ["win32", "rundll32.exe", ["url.dll,FileProtocolHandler", "https://skills.sh/owner/repo/skill"]],
  ] as const)("%s 使用无 shell 的平台命令", async (platform, command, args) => {
    const run = runner();

    await openExternalUrl("https://skills.sh/owner/repo/skill", { platform, run });

    expect(run).toHaveBeenCalledWith(command, args);
  });

  test("拒绝非 http/https URL，且不执行系统命令", async () => {
    const run = runner();

    await expect(openExternalUrl("javascript:alert(1)", { platform: "darwin", run })).rejects.toThrow(
      "Unsupported external URL protocol",
    );
    await expect(openExternalUrl("not a url", { platform: "darwin", run })).rejects.toThrow("Invalid external URL");
    expect(run).not.toHaveBeenCalled();
  });

  test("不支持的平台明确失败", async () => {
    const run = runner();
    await expect(openExternalUrl("https://example.com", { platform: "aix", run })).rejects.toThrow(
      "Opening URLs is not supported",
    );
    expect(run).not.toHaveBeenCalled();
  });
});
