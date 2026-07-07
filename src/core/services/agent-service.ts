import fs from "node:fs/promises";
import path from "node:path";
import type { AgentConfig, AppConfig } from "../models/config.js";
import { detectAgentInstalled, isBuiltinAgent, type ConfigStore } from "../storage/config-store.js";
import type { StateStore } from "../storage/state-store.js";
import { pathExists } from "../../utils/fs.js";
import { resolveConfiguredPath } from "../../utils/path.js";
import { bizError } from "../errors.js";

/**
 * Agent 启停服务（task 07-06-cli-tui-bugfix · R5）。
 *
 * 只读 + 写 config.agents[id].enabled：listAgents 附带安装检测结果供展示，
 * setAgentEnabled 落盘 config.toml。实际 symlink 建删仍由 install-service 按 enabled 过滤。
 */

/** agent 列表行：含安装检测结果，供 CLI/TUI 展示。 */
export interface AgentRow {
  id: string;
  name: string;
  enabled: boolean;
  installed: boolean;
  skills_dir: string;
}

/** 列出全部 agent 及其安装检测状态（保持 config 声明顺序）。 */
export async function listAgents(config: AppConfig): Promise<AgentRow[]> {
  const rows: AgentRow[] = [];
  for (const [id, agent] of Object.entries(config.agents)) {
    rows.push({
      id,
      name: agent.name || id,
      enabled: agent.enabled,
      installed: await detectAgentInstalled(agent),
      skills_dir: agent.skills_dir,
    });
  }
  return rows;
}

/** 启用/禁用 agent（落盘 config.toml）。未知 id 抛错。 */
export async function setAgentEnabled(configStore: ConfigStore, id: string, enabled: boolean): Promise<void> {
  const config = await configStore.read();
  const agent = config.agents[id];
  if (!agent) throw bizError("AGENT_NOT_FOUND", { id }, `Unknown agent: ${id}`);
  agent.enabled = enabled;
  await configStore.write(config);
}

/**
 * 添加自定义 agent（task 07-06-cli-tui-bugfix · R5+）。
 * 不局限于 createDefaultConfig 的默认 7 个：可注册任意 agent id + skills_dir，
 * 之后即可在 matrix 出现并参与 symlink 分发。id 须为小写 `[a-z0-9-]`，不可重复。
 */
export async function addAgent(
  configStore: ConfigStore,
  id: string,
  options: { skillsDir: string; name?: string; enabled?: boolean }
): Promise<AgentConfig> {
  if (!/^[a-z0-9-]+$/.test(id)) throw bizError("AGENT_ID_INVALID", { id }, `Invalid agent id: ${id} (allowed: lowercase [a-z0-9-])`);
  const config = await configStore.read();
  if (config.agents[id]) throw bizError("AGENT_ALREADY_EXISTS", { id }, `Agent already exists: ${id}`);
  const agent: AgentConfig = {
    name: options.name?.trim() || id,
    enabled: options.enabled ?? true,
    skills_dir: options.skillsDir,
  };
  config.agents[id] = agent;
  await configStore.write(config);
  return agent;
}

/**
 * 删除自定义 agent（task 07-06-cli-tui-bugfix · R5+）。
 *
 * 内置 agent（createDefaultConfig 默认集合）不可删——只能禁用；自定义 agent 可删。
 * 清理范围严格限定 ASM 自己的产物：只删该 agent skills_dir 下指向 SSOT 的 symlink，
 * real dir / 指向别处的外部 symlink 一律保留；再清 state 里该 agent 的 enabledAgents 记录，
 * 最后删 config.agents[id]。
 */
export async function removeAgent(configStore: ConfigStore, stateStore: StateStore, id: string): Promise<void> {
  const config = await configStore.read();
  const agent = config.agents[id];
  if (!agent) throw bizError("AGENT_NOT_FOUND", { id }, `Unknown agent: ${id}`);
  if (isBuiltinAgent(id)) throw bizError("AGENT_BUILTIN_NO_REMOVE", { id }, `Cannot remove builtin agent: ${id} (disable it via space instead)`);

  // 1) 删 agent skills_dir 下指向 SSOT 的 symlink（ASM 管理的）；real dir / 外部 symlink 保留。
  await removeAsmSymlinks(resolveConfiguredPath(agent.skills_dir), resolveConfiguredPath(config.paths.skills));

  // 2) 清 state 里该 agent 的 enabledAgents 记录（SSOT 内容保留，仅断开该 agent 的分发关系）。
  const state = await stateStore.read();
  for (const record of Object.values(state.installedSkills)) {
    if (record.enabledAgents[id]) delete record.enabledAgents[id];
  }
  await stateStore.write(state);

  // 3) 删 config.agents[id]。
  delete config.agents[id];
  await configStore.write(config);
}

/**
 * 扫描 dir，删除指向 ssotRoot（SSOT）的 symlink；real dir 与指向别处的 symlink 一律保留。
 * best-effort：单个 symlink 处理失败不阻断整体。
 */
async function removeAsmSymlinks(dir: string, ssotRoot: string): Promise<void> {
  if (!(await pathExists(dir))) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    const linkPath = path.join(dir, entry.name);
    try {
      const resolved = path.resolve(dir, await fs.readlink(linkPath));
      if (resolved === ssotRoot || resolved.startsWith(ssotRoot + path.sep)) {
        await fs.unlink(linkPath);
      }
    } catch {
      // best-effort：跳过单个失败的 symlink
    }
  }
}
