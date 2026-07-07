import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  agentDetectPath,
  createDefaultConfig,
  detectAgentInstalled,
  ConfigStore,
  isBuiltinAgent
} from "../src/core/storage/config-store.js";
import { StateStore } from "../src/core/storage/state-store.js";
import { addAgent, listAgents, removeAgent, setAgentEnabled } from "../src/core/services/agent-service.js";
import { buildAgentColumns } from "../src/tui/state/projection.js";
import { isBizError } from "../src/core/errors.js";

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("agent 安装检测 (R5)", () => {
  test("agentDetectPath = skills_dir 的父目录（~ 展开）", () => {
    const agent = { name: "Claude", enabled: true, skills_dir: "~/.claude/skills" };
    expect(agentDetectPath(agent)).toBe(path.dirname(path.join(os.homedir(), ".claude", "skills")));
  });

  test("detectAgentInstalled: 父目录存在 → true，缺失 → false", async () => {
    const existing = await tempDir("asm-agent-exist-");
    const present = { name: "X", enabled: true, skills_dir: path.join(existing, "skills") };
    expect(await detectAgentInstalled(present)).toBe(true);

    const missing = { name: "Y", enabled: true, skills_dir: path.join(existing, "nope-deep", "skills") };
    expect(await detectAgentInstalled(missing)).toBe(false);
  });

  test("init 首次创建按检测决定 enabled", async () => {
    const home = await tempDir("asm-agent-init-");
    const store = new ConfigStore(home);
    const config = await store.init();
    for (const agent of Object.values(config.agents)) {
      expect(agent.enabled).toBe(await detectAgentInstalled(agent));
    }
  });

  test("createDefaultConfig 仍含全部已知 agent", () => {
    const config = createDefaultConfig();
    expect(Object.keys(config.agents).sort()).toEqual([
      "claude",
      "codex",
      "gemini",
      "hermes",
      "openclaw",
      "opencode",
      "pi",
    ]);
  });
});

describe("agent-service (R5)", () => {
  test("listAgents 附带 installed 检测，保持声明顺序", async () => {
    const home = await tempDir("asm-agent-list-");
    const store = new ConfigStore(home);
    await store.init();
    const config = await store.read();
    config.agents = {
      zed: { name: "Zed", enabled: false, skills_dir: path.join(home, "zed", "skills") },
      claude: { name: "Claude", enabled: true, skills_dir: path.join(home, "claude", "skills") },
    };
    await store.write(config);
    const rows = await listAgents(await store.read());
    expect(rows.map((r) => r.id)).toEqual(["zed", "claude"]);
    expect(rows[0].enabled).toBe(false);
    expect(rows[1].enabled).toBe(true);
    // 两个安装目录都不存在 → installed 全 false
    expect(rows.every((r) => r.installed === false)).toBe(true);
  });

  test("setAgentEnabled 落盘 + 未知 id 抛错", async () => {
    const home = await tempDir("asm-agent-set-");
    const store = new ConfigStore(home);
    await store.init();
    await setAgentEnabled(store, "claude", false);
    const config = await store.read();
    expect(config.agents.claude!.enabled).toBe(false);
    await expect(setAgentEnabled(store, "no-such-agent", true)).rejects.toThrow(/Unknown agent/);
  });
});

describe("buildAgentColumns includeDisabled (R5)", () => {
  test("默认 includeDisabled=true 保留全部列（向后兼容）", () => {
    const cols = buildAgentColumns({
      a: { name: "A", enabled: true },
      b: { name: "B", enabled: false },
    });
    expect(cols.map((c) => c.id)).toEqual(["a", "b"]);
  });

  test("includeDisabled=false 过滤 disabled", () => {
    const cols = buildAgentColumns(
      { a: { name: "A", enabled: true }, b: { name: "B", enabled: false } },
      { includeDisabled: false }
    );
    expect(cols.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("agent add/remove (R5+)", () => {
  test("addAgent 写入 config + 默认 enabled + name 回退 id", async () => {
    const home = await tempDir("asm-agent-add-");
    const store = new ConfigStore(home);
    await store.init();
    const agent = await addAgent(store, "myagent", { skillsDir: "/tmp/myagent/skills", name: "My Agent" });
    expect(agent.name).toBe("My Agent");
    expect(agent.enabled).toBe(true);
    const config = await store.read();
    expect(config.agents.myagent!.skills_dir).toBe("/tmp/myagent/skills");
  });

  test("addAgent 非法 id / 重复 id 抛错", async () => {
    const home = await tempDir("asm-agent-add2-");
    const store = new ConfigStore(home);
    await store.init();
    await expect(addAgent(store, "Bad ID", { skillsDir: "/x" })).rejects.toThrow(/Invalid agent id/);
    await addAgent(store, "dup", { skillsDir: "/x" });
    await expect(addAgent(store, "dup", { skillsDir: "/y" })).rejects.toThrow(/already exists/);
  });

  test("removeAgent 删自定义 + 内置拒绝 + 未知 id 抛错", async () => {
    const home = await tempDir("asm-agent-rm-");
    const store = new ConfigStore(home);
    const stateStore = new StateStore(store.home);
    await store.init();
    // 内置不可删
    expect(isBuiltinAgent("claude")).toBe(true);
    await expect(removeAgent(store, stateStore, "claude")).rejects.toThrow(/builtin/);
    // 自定义可删
    await addAgent(store, "tmp", { skillsDir: path.join(home, "tmp-skills") });
    await removeAgent(store, stateStore, "tmp");
    const config = await store.read();
    expect(config.agents.tmp).toBeUndefined();
    // 未知 id
    await expect(removeAgent(store, stateStore, "tmp")).rejects.toThrow(/Unknown agent/);
  });
});

/** 捕获 promise 的 rejection，断言是 BizError 且 code 匹配（W1 错误码断言 helper）。 */
async function expectBizCode(p: Promise<unknown>, code: string): Promise<void> {
  const e = await p.catch((x: unknown) => x);
  expect(isBizError(e)).toBe(true);
  expect((e as { code?: unknown }).code).toBe(code);
}

describe("agent-service 业务错误码（W1）", () => {
  test("AGENT_NOT_FOUND: setAgentEnabled / removeAgent 未知 id", async () => {
    const home = await tempDir("asm-ag-nf-");
    const store = new ConfigStore(home);
    const stateStore = new StateStore(store.home);
    await store.init();
    await expectBizCode(setAgentEnabled(store, "nope", true), "AGENT_NOT_FOUND");
    await expectBizCode(removeAgent(store, stateStore, "nope"), "AGENT_NOT_FOUND");
  });

  test("AGENT_ID_INVALID: addAgent 非法 id", async () => {
    const home = await tempDir("asm-ag-invalid-");
    const store = new ConfigStore(home);
    await store.init();
    await expectBizCode(addAgent(store, "Bad ID", { skillsDir: "/x" }), "AGENT_ID_INVALID");
  });

  test("AGENT_ALREADY_EXISTS: addAgent 重复 id", async () => {
    const home = await tempDir("asm-ag-dup-");
    const store = new ConfigStore(home);
    await store.init();
    await addAgent(store, "dup", { skillsDir: "/x" });
    await expectBizCode(addAgent(store, "dup", { skillsDir: "/y" }), "AGENT_ALREADY_EXISTS");
  });

  test("AGENT_BUILTIN_NO_REMOVE: removeAgent 内置 agent", async () => {
    const home = await tempDir("asm-ag-builtin-");
    const store = new ConfigStore(home);
    const stateStore = new StateStore(store.home);
    await store.init();
    await expectBizCode(removeAgent(store, stateStore, "claude"), "AGENT_BUILTIN_NO_REMOVE");
  });
});
